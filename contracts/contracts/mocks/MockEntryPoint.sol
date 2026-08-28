// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPaymaster, PackedUserOperation, PostOpMode} from "../interfaces/IERC4337.sol";

/// @notice Just enough EntryPoint to drive a paymaster through validate/postOp
///         in tests. Deposit accounting is real; signature verification, the
///         bundler rules and the rest of v0.7 are not, and are not what the
///         paymaster's own tests are checking.
contract MockEntryPoint {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address account => uint256 amount) public stakeOf;
    mapping(address account => uint32 delay) public unstakeDelayOf;

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function withdrawTo(address payable to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "insufficient deposit");
        balanceOf[msg.sender] -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
    }

    function addStake(uint32 unstakeDelaySec) external payable {
        stakeOf[msg.sender] += msg.value;
        unstakeDelayOf[msg.sender] = unstakeDelaySec;
    }

    function unlockStake() external {
        unstakeDelayOf[msg.sender] = 0;
    }

    function withdrawStake(address payable to) external {
        uint256 amount = stakeOf[msg.sender];
        stakeOf[msg.sender] = 0;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "stake withdraw failed");
    }

    // --- test drivers ---

    function callValidate(address paymaster, PackedUserOperation calldata userOp, uint256 maxCost)
        external
        returns (bytes memory context, uint256 validationData)
    {
        return IPaymaster(paymaster).validatePaymasterUserOp(userOp, bytes32(0), maxCost);
    }

    function callPostOp(
        address paymaster,
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external {
        // Charge the deposit the way the real EntryPoint does, so tests can see
        // the runway shrink as operations are sponsored.
        if (balanceOf[paymaster] >= actualGasCost) {
            balanceOf[paymaster] -= actualGasCost;
        }
        IPaymaster(paymaster).postOp(mode, context, actualGasCost, 1);
    }
}
