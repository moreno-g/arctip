// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {TipJar} from "./TipJar.sol";
import {
    IPaymaster,
    IEntryPoint,
    PackedUserOperation,
    PostOpMode
} from "./interfaces/IERC4337.sol";

/// @title ArcTipPaymaster
/// @notice Pays the gas for tips so a fan never needs a gas balance to support
///         someone, and funds that sponsorship out of the tips themselves.
///
/// @dev Why this exists at all, given that Arc uses USDC as its native gas
///      asset. The usual "buy the chain's token before you can pay" problem is
///      already gone here — a fan holding USDC can pay their own gas. What is
///      left is narrower and still fatal to the flow:
///
///        1. A wallet created from a passkey seconds ago holds exactly zero.
///        2. A fan holding exactly 5 USDC cannot send a 5 USDC tip, because
///           some of it has to stay behind for gas. The round number is the
///           whole product, and it is the one amount that fails.
///
///      Both are gas problems, not balance problems. This contract solves those
///      and nothing else: it never funds the tip itself, only its execution.
///
///      The economics are measured, not assumed. On Arc testnet at the observed
///      21 gwei, a tip costs ~66k gas on its own and ~186k sponsored through
///      ERC-4337 — about 0.0039 USDC. The fee is deliberately set to cover that
///      and little else: at 1%, a 1 USDC tip yields 0.01 USDC against 0.0039 of
///      gas, 2.6x cover. Break-even sits at 0.39 USDC, and the floor is set at
///      1 USDC so the margin survives gas rising two and a half times before any
///      sponsored tip runs at a loss. Under the floor a fan pays their own gas,
///      which on Arc they can already do.
///
///      Fees are charged on every tip, but only tips from passkey wallets are
///      sponsored — one sent from a browser wallet pays the fee and costs us
///      nothing. Real cover is therefore better than these figures, which are
///      the worst case.
///
///      That floor is also the anti-drain measure. Sponsorship is open to
///      anyone, so it has to survive someone tipping their own handle in a loop:
///      each round trip costs the attacker the fee and costs us less than that
///      in gas, so the loop drains the attacker first. Griefing us means paying
///      more than we lose.
contract ArcTipPaymaster is IPaymaster, Ownable2Step, Pausable {
    /// @dev The v0.7 singleton, identical on every chain and confirmed deployed
    ///      on Arc testnet. Immutable: a paymaster that could be repointed at an
    ///      attacker-controlled EntryPoint would hand over its whole deposit.
    IEntryPoint public immutable entryPoint;

    /// @dev Immutable for the same reason, and so validation stays cheap.
    TipJar public immutable tipJar;

    /// @dev ERC-6900 / ERC-4337 accounts, Circle's MSCA included, route calls
    ///      through `execute(address,uint256,bytes)`.
    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));

    /// @notice Smallest tip that gets its gas sponsored. Below this the fee no
    ///         longer covers the gas — see the note on this contract.
    uint256 public minSponsoredTip = 1 ether;

    /// @notice Refuses to sponsor a single operation costing more than this, so
    ///         a gas price spike cannot drain the deposit one op at a time.
    uint256 public maxCostPerOp = 0.05 ether;

    // Published so the sponsorship can be audited against the fees that funded
    // it, rather than taken on trust.
    uint256 public sponsoredOps;
    uint256 public gasSponsored;
    uint256 public feesReceived;

    event Sponsored(address indexed account, uint256 gasCost);
    event SponsorshipFunded(uint256 amount, uint256 newDeposit);
    event MinSponsoredTipUpdated(uint256 minSponsoredTip);
    event MaxCostPerOpUpdated(uint256 maxCostPerOp);

    error NotEntryPoint();
    error NotAnExecuteCall();
    error NotATipCall();
    error TipBelowFloor(uint256 value, uint256 floor);
    error CostAboveCap(uint256 maxCost, uint256 cap);
    error ZeroAddress();
    error NothingToSweep();

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
        _;
    }

    constructor(address entryPointAddress, address tipJarAddress, address initialOwner)
        Ownable(initialOwner)
    {
        if (entryPointAddress == address(0) || tipJarAddress == address(0)) revert ZeroAddress();
        entryPoint = IEntryPoint(entryPointAddress);
        tipJar = TipJar(payable(tipJarAddress));
    }

    // --- ERC-4337 ---

    /// @notice Agrees to pay for a UserOperation, but only a genuine tip.
    /// @dev Deliberately narrow. The operation is sponsored only when it is a
    ///      single `execute` into this specific TipJar calling `tip`, carrying
    ///      at least the floor. Anything else reverts, so the deposit cannot be
    ///      spent on arbitrary calls dressed up as tips.
    ///
    ///      This reads `minSponsoredTip` and `maxCostPerOp` from storage during
    ///      validation, which under ERC-7562 requires the paymaster to be
    ///      staked. `addStake` below does that; the deploy script calls it.
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256 maxCost
    ) external view override onlyEntryPoint whenNotPaused returns (bytes memory, uint256) {
        if (maxCost > maxCostPerOp) revert CostAboveCap(maxCost, maxCostPerOp);

        bytes calldata callData = userOp.callData;
        if (callData.length < 4 || bytes4(callData[:4]) != EXECUTE_SELECTOR) {
            revert NotAnExecuteCall();
        }

        (address target, uint256 value, bytes memory inner) =
            abi.decode(callData[4:], (address, uint256, bytes));

        if (target != address(tipJar)) revert NotATipCall();
        if (inner.length < 4 || bytes4(inner) != TipJar.tip.selector) revert NotATipCall();
        if (value < minSponsoredTip) revert TipBelowFloor(value, minSponsoredTip);

        // The sender is all postOp needs, and a short context keeps the op cheap.
        return (abi.encode(userOp.sender), 0);
    }

    /// @notice Books what the sponsorship actually cost, after the fact.
    /// @dev Never reverts on a failed tip: the EntryPoint has already charged
    ///      the deposit by this point, so reverting here would only burn more
    ///      gas without recovering anything.
    function postOp(
        PostOpMode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256
    ) external override onlyEntryPoint {
        address account = abi.decode(context, (address));
        unchecked {
            ++sponsoredOps;
            gasSponsored += actualGasCost;
        }
        emit Sponsored(account, actualGasCost);
    }

    // --- Funding ---

    /// @notice Takes in the TipJar fees that pay for the sponsorship.
    /// @dev Kept to a bare counter bump. TipJar forwards fees with a 50k gas
    ///      bound, and a deposit into the EntryPoint from here would risk
    ///      exceeding it — a fee that ran out of gas would fall into TipJar's
    ///      `pendingWithdrawal` instead of arriving. Moving the balance into the
    ///      deposit is `sweepToDeposit`'s job, on its own transaction.
    receive() external payable {
        unchecked {
            feesReceived += msg.value;
        }
    }

    /// @notice Moves the collected fees into the EntryPoint deposit that pays
    ///         for gas. Deliberately open to anyone: it only ever tops up this
    ///         contract's own deposit, so there is nothing to gain by calling it
    ///         and something to lose if sponsorship stalls waiting on us.
    function sweepToDeposit() external {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToSweep();
        entryPoint.depositTo{value: amount}(address(this));
        emit SponsorshipFunded(amount, entryPoint.balanceOf(address(this)));
    }

    /// @notice Top the deposit up directly, out of band from the fees.
    function fundDeposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit SponsorshipFunded(msg.value, entryPoint.balanceOf(address(this)));
    }

    // --- Views ---

    /// @notice What is left to sponsor with.
    function deposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    /// @notice Tips still sponsorable at the current deposit and cap, so the
    ///         page can warn before sponsorship runs dry rather than after.
    function sponsorshipRunway() external view returns (uint256) {
        return entryPoint.balanceOf(address(this)) / maxCostPerOp;
    }

    /// @notice Whether the fees have covered the gas, in basis points of
    ///         coverage: 10_000 means the sponsorship exactly paid for itself.
    /// @dev Returns 0 before any gas has been sponsored, rather than dividing
    ///      by zero to report infinite coverage.
    function feeCoverageBps() external view returns (uint256) {
        if (gasSponsored == 0) return 0;
        return (feesReceived * 10_000) / gasSponsored;
    }

    // --- Admin ---

    function setMinSponsoredTip(uint256 newFloor) external onlyOwner {
        minSponsoredTip = newFloor;
        emit MinSponsoredTipUpdated(newFloor);
    }

    function setMaxCostPerOp(uint256 newCap) external onlyOwner {
        maxCostPerOp = newCap;
        emit MaxCostPerOpUpdated(newCap);
    }

    /// @notice Stake with the EntryPoint. Required before bundlers will accept
    ///         operations from a paymaster that reads storage while validating.
    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    function withdrawStake(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        entryPoint.withdrawStake(to);
    }

    /// @notice Pull sponsorship funds back out of the EntryPoint deposit.
    function withdrawDeposit(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        entryPoint.withdrawTo(to, amount);
    }

    /// @notice Stop sponsoring without withdrawing anything. Tips keep working:
    ///         a fan just pays their own gas, which on Arc they already can.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
