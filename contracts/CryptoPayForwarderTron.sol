// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * CryptoPayForwarderTron
 *
 * The relayer wallet receives USDT-TRC20 directly from ChangeNOW's payout
 * (it owns those funds outright — no allowance-pull needed, unlike the
 * Ethereum V1/V2 pattern). It deposits the funds into this contract, then
 * calls forwardToken to complete delivery to the client's wallet with a
 * permanent on-chain memo, mirroring CryptoPayForwarderV2's memo pattern.
 */
contract CryptoPayForwarderTron {
    address public immutable relayer;

    event Payment(address indexed to, address token, uint256 amount, string memo);

    constructor(address _relayer) {
        require(_relayer != address(0), "bad relayer");
        relayer = _relayer;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "not authorized");
        _;
    }

    /// Forwards tokens this contract is currently holding (sent here by the
    /// relayer beforehand) on to the client, emitting a permanent memo.
    function forwardToken(address token, address to, uint256 amount, string calldata memo) external onlyRelayer {
        require(to != address(0), "bad recipient");
        _safeTransfer(token, to, amount);
        emit Payment(to, token, amount, memo);
    }

    /// Tolerates tokens that return no data on success (some USDT deployments
    /// do this) — same pattern as OpenZeppelin's SafeERC20, since real value
    /// moves through this call.
    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }
}
