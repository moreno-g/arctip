// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TipJar
/// @notice Lets a creator claim a handle and receive USDC tips settled natively on Arc.
/// @dev On Arc, USDC is the native gas asset — tips move as plain value transfers (msg.value),
///      not ERC-20 transferFrom. That removes the approve/allowance step (and its attack surface)
///      entirely for the core flow.
contract TipJar is Ownable2Step, Pausable, ReentrancyGuard {
    uint256 public constant MAX_FEE_BPS = 500; // hard cap: fee can never exceed 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_HANDLE_LENGTH = 32;

    uint256 public feeBps = 200; // 2% default
    address public treasury;

    mapping(bytes32 handleHash => address payoutAddress) private _handleOwner;
    mapping(bytes32 handleHash => string handle) private _handleText;
    mapping(address owner => string handle) public ownerHandle;

    event HandleRegistered(string handle, address indexed owner);
    event Tipped(
        string handle,
        address indexed recipient,
        address indexed sender,
        uint256 amount,
        uint256 fee,
        string message
    );
    event FeeUpdated(uint256 feeBps);
    event TreasuryUpdated(address treasury);

    error HandleTaken();
    error HandleNotRegistered();
    error HandleInvalid();
    error ZeroTip();
    error FeeTooHigh();
    error ZeroAddress();
    error TransferFailed();

    constructor(address initialTreasury, address initialOwner) Ownable(initialOwner) {
        if (initialTreasury == address(0)) revert ZeroAddress();
        treasury = initialTreasury;
    }

    /// @notice Claim a handle. First come, first served; a handle can never be reassigned.
    function register(string calldata handle) external whenNotPaused {
        bytes memory raw = bytes(handle);
        if (raw.length == 0 || raw.length > MAX_HANDLE_LENGTH) revert HandleInvalid();

        bytes32 key = _key(handle);
        if (_handleOwner[key] != address(0)) revert HandleTaken();

        _handleOwner[key] = msg.sender;
        _handleText[key] = handle;
        ownerHandle[msg.sender] = handle;
        emit HandleRegistered(handle, msg.sender);
    }

    /// @notice Send a tip (in native USDC) to a registered handle.
    /// @param handle The recipient's handle.
    /// @param message Optional public note shown alongside the tip.
    function tip(string calldata handle, string calldata message)
        external
        payable
        whenNotPaused
        nonReentrant
    {
        if (msg.value == 0) revert ZeroTip();

        address recipient = _handleOwner[_key(handle)];
        if (recipient == address(0)) revert HandleNotRegistered();

        uint256 fee = (msg.value * feeBps) / BPS_DENOMINATOR;
        uint256 net = msg.value - fee;

        emit Tipped(handle, recipient, msg.sender, msg.value, fee, message);

        _send(recipient, net);
        if (fee > 0) _send(treasury, fee);
    }

    function handleOwner(string calldata handle) external view returns (address) {
        return _handleOwner[_key(handle)];
    }

    function isHandleTaken(string calldata handle) external view returns (bool) {
        return _handleOwner[_key(handle)] != address(0);
    }

    // --- Admin ---

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
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

    function _key(string calldata handle) private pure returns (bytes32) {
        return keccak256(bytes(handle));
    }

    function _send(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
