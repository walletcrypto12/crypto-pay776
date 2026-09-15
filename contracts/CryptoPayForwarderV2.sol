// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * CryptoPayForwarderV2
 *
 * Adds relayer-pulled payments on top of the V1 self-service pattern:
 * once a user has approved this contract, the platform's relayer can
 * complete the payment on their behalf (paying gas itself) using the
 * existing allowance — no second wallet signature required from the user.
 *
 * payTokenFrom is restricted to the relayer address specifically because
 * an open version would let ANYONE pull funds from ANY wallet that has
 * ever approved this contract, to any destination they choose.
 */
contract CryptoPayForwarderV2 {
    address public immutable relayer;

    event Payment(
        address indexed from,
        address indexed to,
        address token,   // address(0) for native
        uint256 amount,
        string memo
    );

    constructor(address _relayer) {
        require(_relayer != address(0), "bad relayer");
        relayer = _relayer;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "not authorized");
        _;
    }

    /// Relayer-pulled payment — uses a pre-existing allowance from `from`.
    function payTokenFrom(address token, address from, address to, uint256 amount, string calldata memo) external onlyRelayer {
        require(to != address(0), "bad recipient");
        require(IERC20(token).transferFrom(from, to, amount), "transfer failed");
        emit Payment(from, to, token, amount, memo);
    }

    /// Self-service payment — caller must have approved this contract beforehand.
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
