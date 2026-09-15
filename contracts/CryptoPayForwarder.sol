// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * CryptoPayForwarder
 *
 * A thin pass-through: forwards an ERC-20 or native payment to its
 * destination in the same transaction, emitting a memo alongside it.
 * Never holds funds beyond the single atomic transaction that moves
 * them through — nothing is custodied here between calls.
 */
contract CryptoPayForwarder {
    event Payment(
        address indexed from,
        address indexed to,
        address token,   // address(0) for native
        uint256 amount,
        string memo
    );

    /// Caller must have approved this contract for `amount` beforehand.
    function payToken(address token, address to, uint256 amount, string calldata memo) external {
        require(to != address(0), "bad recipient");
        require(IERC20(token).transferFrom(msg.sender, to, amount), "transfer failed");
        emit Payment(msg.sender, to, token, amount, memo);
    }

    function payNative(address payable to, string calldata memo) external payable {
        require(to != address(0), "bad recipient");
        require(msg.value > 0, "no value sent");
        (bool sent, ) = to.call{value: msg.value}("");
        require(sent, "transfer failed");
        emit Payment(msg.sender, to, address(0), msg.value, memo);
    }
}
