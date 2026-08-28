// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The subset of ERC-4337 v0.7 this project needs, written out rather
///         than pulled in as a dependency. `@account-abstraction/contracts`
///         brings a full account, factory and test harness along with it, and
///         all we consume is two structs and a handful of EntryPoint calls.
///
///         Verified on Arc testnet (chain 5042002): the canonical v0.6, v0.7 and
///         v0.8 EntryPoints are all deployed. This targets v0.7, whose singleton
///         lives at 0x0000000071727De22E5E9d8BAf0edAc6f37da032 on every chain.

/// @dev v0.7 packs gas limits into single words to keep calldata small.
///      accountGasLimits = verificationGasLimit (high 128) | callGasLimit (low 128)
///      gasFees          = maxPriorityFeePerGas (high 128) | maxFeePerGas (low 128)
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}

interface IPaymaster {
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpGasPrice
    ) external;
}

interface IEntryPoint {
    function depositTo(address account) external payable;

    function balanceOf(address account) external view returns (uint256);

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;

    /// @dev A paymaster that reads its own storage during validation must be
    ///      staked, or bundlers will reject the UserOperation.
    function addStake(uint32 unstakeDelaySec) external payable;

    function unlockStake() external;

    function withdrawStake(address payable withdrawAddress) external;
}
