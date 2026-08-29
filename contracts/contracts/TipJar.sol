// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TipJar
/// @notice Lets a creator claim a handle and receive USDC tips settled natively on Arc.
/// @dev On Arc, USDC is the native gas asset — tips move as plain value transfers
///      (msg.value), not ERC-20 transferFrom, which removes the approve/allowance
///      step and its attack surface from the core flow.
///
///      Known and accepted: `register` is front-runnable. The handle sits in the
///      mempool in the clear, so a watcher can copy it and outbid the gas price.
///      A commit-reveal scheme is the only real fix and it doubles the
///      transactions on the one flow that most needs to be frictionless. The
///      trade is deliberate at this stage, and worth revisiting once handles
///      carry enough value to be worth sniping.
contract TipJar is Ownable2Step, Pausable, ReentrancyGuard {
    uint256 public constant MAX_FEE_BPS = 500; // hard cap: fee can never exceed 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_HANDLE_LENGTH = 32;
    uint256 public constant MAX_MESSAGE_LENGTH = 280;
    /// @dev Bounded so a hostile or broken recipient cannot burn the tipper's gas.
    ///      Anything that needs more simply falls through to `pendingWithdrawal`.
    uint256 private constant PAYOUT_GAS = 50_000;

    address public treasury;
    /// @dev 1%, set to cover the gas ArcTipPaymaster sponsors rather than to make
    ///      a margin. A sponsored tip costs ~0.0039 USDC at the gas price observed
    ///      on Arc; 1% of a 1 USDC tip is 0.01, which covers it 2.6x and still
    ///      holds if gas doubles. Packed with treasury in slot 0.
    uint16 public feeBps = 100;

    // Readable counters. Deriving these from logs is not an option: Arc produces
    // ~187k blocks a day, and public RPCs reject unbounded eth_getLogs ranges,
    // so a scan that works today silently stops working within weeks.
    uint256 public handleCount;
    uint256 public tipCount;
    uint256 public totalTipped;

    mapping(bytes32 handleHash => address payoutAddress) private _handleOwner;
    /// @notice One handle per address, so the dashboard is never ambiguous.
    mapping(address owner => string handle) public ownerHandle;
    /// @notice Credited only when a direct payout fails; claimed with `withdraw`.
    mapping(address payee => uint256 amount) public pendingWithdrawal;

    event HandleRegistered(string handle, address indexed owner);
    event HandleTransferred(string handle, address indexed from, address indexed to);
    event Tipped(
        string handle,
        address indexed recipient,
        address indexed sender,
        uint256 amount,
        uint256 fee,
        string message
    );
    event PayoutDeferred(address indexed payee, uint256 amount);
    event Withdrawn(address indexed payee, uint256 amount);
    event FeeUpdated(uint256 feeBps);
    event TreasuryUpdated(address treasury);

    error HandleTaken();
    error HandleNotRegistered();
    error HandleInvalid();
    error AlreadyHasHandle();
    error NotHandleOwner();
    error ZeroTip();
    error MessageTooLong();
    error FeeAboveMax(uint256 currentFeeBps, uint256 maxFeeBps);
    error FeeTooHigh();
    error ZeroAddress();
    error NothingToWithdraw();
    error TransferFailed();

    constructor(address initialTreasury, address initialOwner) Ownable(initialOwner) {
        if (initialTreasury == address(0)) revert ZeroAddress();
        treasury = initialTreasury;
    }

    /// @notice Claim a handle. First come, first served.
    function register(string calldata handle) external whenNotPaused {
        _validateHandle(handle);
        if (bytes(ownerHandle[msg.sender]).length != 0) revert AlreadyHasHandle();

        bytes32 key = _key(handle);
        if (_handleOwner[key] != address(0)) revert HandleTaken();

        _handleOwner[key] = msg.sender;
        ownerHandle[msg.sender] = handle;
        unchecked {
            ++handleCount;
        }
        emit HandleRegistered(handle, msg.sender);
    }

    /// @notice Move a handle to another wallet. Without this, losing access to a
    ///         wallet means losing the handle and every future tip permanently.
    function transferHandle(string calldata handle, address newOwner) external whenNotPaused {
        if (newOwner == address(0)) revert ZeroAddress();

        bytes32 key = _key(handle);
        if (_handleOwner[key] != msg.sender) revert NotHandleOwner();
        if (bytes(ownerHandle[newOwner]).length != 0) revert AlreadyHasHandle();

        _handleOwner[key] = newOwner;
        delete ownerHandle[msg.sender];
        ownerHandle[newOwner] = handle;

        emit HandleTransferred(handle, msg.sender, newOwner);
    }

    /// @notice Send a tip (in native USDC) to a registered handle.
    /// @param handle The recipient's handle.
    /// @param message Optional public note shown alongside the tip.
    /// @param maxFeeBps Highest fee the sender agrees to. The page shows a fee
    ///        before the wallet prompt, and the owner can raise it in between;
    ///        this makes that race revert instead of silently overcharging.
    function tip(string calldata handle, string calldata message, uint256 maxFeeBps)
        external
        payable
        whenNotPaused
        nonReentrant
    {
        if (msg.value == 0) revert ZeroTip();
        if (bytes(message).length > MAX_MESSAGE_LENGTH) revert MessageTooLong();

        uint256 currentFee = feeBps;
        if (currentFee > maxFeeBps) revert FeeAboveMax(currentFee, maxFeeBps);

        address recipient = _handleOwner[_key(handle)];
        if (recipient == address(0)) revert HandleNotRegistered();

        uint256 fee = (msg.value * currentFee) / BPS_DENOMINATOR;
        uint256 net = msg.value - fee;

        unchecked {
            ++tipCount;
            totalTipped += msg.value;
        }

        emit Tipped(handle, recipient, msg.sender, msg.value, fee, message);

        _payout(recipient, net);
        if (fee > 0) _payout(treasury, fee);
    }

    /// @notice Claim anything a failed direct payout left credited to you.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawal[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawal[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function handleOwner(string calldata handle) external view returns (address) {
        return _handleOwner[_key(handle)];
    }

    function isHandleTaken(string calldata handle) external view returns (bool) {
        return _handleOwner[_key(handle)] != address(0);
    }

    // --- Admin ---

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- Internal ---

    /// @dev Enforced on-chain so the contract and the interface agree on what a
    ///      handle is. Without it, "Alice" and "alice" are different keys while
    ///      the site lowercases everything, leaving handles it can never serve.
    function _validateHandle(string calldata handle) private pure {
        bytes memory raw = bytes(handle);
        if (raw.length == 0 || raw.length > MAX_HANDLE_LENGTH) revert HandleInvalid();

        for (uint256 i = 0; i < raw.length; ++i) {
            bytes1 c = raw[i];
            bool allowed = (c >= 0x61 && c <= 0x7A) // a-z
                || (c >= 0x30 && c <= 0x39) // 0-9
                || c == 0x5F; // _
            if (!allowed) revert HandleInvalid();
        }
    }

    function _key(string calldata handle) private pure returns (bytes32) {
        return keccak256(bytes(handle));
    }

    /// @dev Pays directly, and credits the payee instead of reverting when that
    ///      fails. A recipient that rejects payment would otherwise brick every
    ///      tip to its handle, and a treasury that did the same would brick the
    ///      whole contract.
    function _payout(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount, gas: PAYOUT_GAS}("");
        if (!ok) {
            pendingWithdrawal[to] += amount;
            emit PayoutDeferred(to, amount);
        }
    }
}
