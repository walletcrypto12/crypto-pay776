// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * CryptoPayForwarderTronV2
 *
 * Adds a relayer-pulled payment path on top of V1's forward-what-we-hold
 * pattern: once a buyer approves this contract, the relayer can complete
 * the payment on their behalf (paying energy itself) using the existing
 * allowance — no direct-transfer energy cost falls on the buyer, mirroring
 * CryptoPayForwarderV2's payTokenFrom on Ethereum.
 *
 * payTokenFrom is restricted to the relayer specifically because an open
 * version would let ANYONE pull funds from ANY wallet that has ever
 * approved this contract, to any destination they choose.
 */
contract CryptoPayForwarderTronV2 {
    address public immutable relayer;

    event Payment(address indexed from, address indexed to, address token, uint256 amount, string memo);

    constructor(address _relayer) {
        require(_relayer != address(0), "bad relayer");
        relayer = _relayer;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "not authorized");
        _;
    }

    /// Relayer-pulled payment — uses a pre-existing allowance from `from`.
    /// For buyers who already hold the exact asset the merchant wants and
    /// don't want to pay the energy cost of a direct transfer themselves.
    function payTokenFrom(address token, address from, address to, uint256 amount, string calldata memo) external onlyRelayer {
        require(to != address(0), "bad recipient");
        _safeTransferFrom(token, from, to, amount);
        emit Payment(from, to, token, amount, memo);
    }

    /// Forwards tokens this contract is currently holding (sent here by the
    /// relayer beforehand, e.g. from a ChangeNOW payout) on to the client.
    function forwardToken(address token, address to, uint256 amount, string calldata memo) external onlyRelayer {
        require(to != address(0), "bad recipient");
        _safeTransfer(token, to, amount);
        emit Payment(address(this), to, token, amount, memo);
    }

    /// Tolerates tokens that return no data on success (some USDT deployments
    /// do this) — same pattern as OpenZeppelin's SafeERC20, since real value
    /// moves through these calls.
    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }
}
