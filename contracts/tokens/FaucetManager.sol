// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/token/IERC20.sol";
import "../libraries/math/SafeMath.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/Address.sol";
import "../access/Governable.sol";
import "./interfaces/IWETH.sol";

contract FaucetManager is Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    address public weth;
    bool public isInitialized = false;

    mapping (address => uint256) public faucetAmounts;
    mapping (address => mapping (address => uint256)) public claimedAt;

    event Claim(address account, address token, bool shouldUnwrap, uint256 amount);
    event SetTokenFaucetAmount(address account, address token, uint256 faucetAmount);

    constructor(address _weth) public Governable() {
        weth = _weth;
    }

    function initialize(address[] memory _tokens, uint256[] memory _faucetAmounts) external onlyGov {
        require(!isInitialized, "FaucetManager: already initialized");
        require(_tokens.length == _faucetAmounts.length, "FaucetManager: invalid tokens and faucetAmounts");

        for (uint256 i = 0; i < _tokens.length; i++) {
            faucetAmounts[_tokens[i]] = _faucetAmounts[i];
        }

        isInitialized = true;
    }

    receive() external payable {
        require(msg.sender == weth, "FaucetManager: invalid sender");
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(address _token, address _account, uint256 _amount) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function setTokenFaucetAmount(address _token, uint256 _faucetAmount) external onlyGov {
        require(isInitialized, "FaucetManager: not initialized yet");
        faucetAmounts[_token] = _faucetAmount;
        emit SetTokenFaucetAmount(msg.sender, _token, _faucetAmount);
    }

    function claimToken(address _token, bool _shouldUnwrap) external {
        require(isInitialized, "FaucetManager: not initialized yet");
        require(claimedAt[msg.sender][_token] == 0, "FaucetManager: token already claimed");
        require(faucetAmounts[_token] > 0, "FaucetManager: claiming token is disabled");
        require(
            IERC20(_token).balanceOf(address(this)) > faucetAmounts[_token],
            "FaucetManager: insufficient token balance"
        );
        if (_shouldUnwrap) {
            require(_token == weth, "FaucetManager: invalid wrapped token");
        }

        claimedAt[msg.sender][_token] = block.timestamp;
        if (_shouldUnwrap) {
            IWETH(weth).withdraw(faucetAmounts[_token]);
            msg.sender.sendValue(faucetAmounts[_token]);
        } else {
            IERC20(_token).safeTransfer(msg.sender, faucetAmounts[_token]);
        }

        emit Claim(msg.sender, _token, _shouldUnwrap, faucetAmounts[_token]);
    }

    function getStates(address account, address[] memory tokens) external view returns (uint256[] memory) {
        uint256[] memory values = new uint256[](tokens.length * 2);

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];

            values[i * 2] = faucetAmounts[token];
            values[i * 2 + 1] = claimedAt[account][token];
        }

        return values;
    }
}
