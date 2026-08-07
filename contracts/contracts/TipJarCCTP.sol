// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TipJar} from "./TipJar.sol";

/// @title TipJarCCTP
/// @notice Extension for handling Circle Cross-Chain Transfer Protocol (CCTP) USDC tips.
/// @dev Enables creators registered on TipJar to receive cross-chain USDC tips sent
///      from Ethereum, Solana, Arbitrum, Base, or Polygon via Circle's TokenMessenger.
contract TipJarCCTP is Ownable2Step, ReentrancyGuard {
    TipJar public immutable tipJar;
    address public cctpTokenMessenger;

    event CrossChainTipReceived(
        string indexed handle,
        uint32 indexed sourceDomain,
        address indexed sender,
        uint256 amount
    );
    event CCTPMessengerUpdated(address indexed newMessenger);

    error InvalidMessenger();
    error ZeroAddress();

    constructor(address tipJarAddress, address initialMessenger, address initialOwner)
        Ownable(initialOwner)
    {
        if (tipJarAddress == address(0) || initialMessenger == address(0)) revert ZeroAddress();
        tipJar = TipJar(payable(tipJarAddress));
        cctpTokenMessenger = initialMessenger;
    }

    /// @notice Set or update the Circle TokenMessenger address.
    function setCCTPMessenger(address newMessenger) external onlyOwner {
        if (newMessenger == address(0)) revert ZeroAddress();
        cctpTokenMessenger = newMessenger;
        emit CCTPMessengerUpdated(newMessenger);
    }

    /// @notice Handler for incoming Circle CCTP messages containing tip payloads.
    function handleCCTPTip(
        string calldata handle,
        uint32 sourceDomain,
        address sender,
        uint256 amount
    ) external payable nonReentrant {
        if (msg.sender != cctpTokenMessenger) revert InvalidMessenger();
        
        emit CrossChainTipReceived(handle, sourceDomain, sender, amount);

        // Forward native USDC value directly to TipJar tip function
        tipJar.tip{value: msg.value}(handle, "Cross-chain tip via Circle CCTP", tipJar.feeBps());
    }
}
