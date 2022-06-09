// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

import "../core/interfaces/IFlpManager.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardTracker.sol";

// provide a way to transfer staked FLP tokens by unstaking from the sender
// and staking for the receiver
// tests in RewardRouterV2.js
contract StakedFlp {
    using SafeMath for uint256;

    string public constant name = "StakedFlp";
    string public constant symbol = "sFLP";
    uint8 public constant decimals = 18;

    address public flp;
    IFlpManager public flpManager;
    address public stakedFlpTracker;
    address public feeFlpTracker;

    mapping (address => mapping (address => uint256)) public allowances;

    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        address _flp,
        IFlpManager _flpManager,
        address _stakedFlpTracker,
        address _feeFlpTracker
    ) public {
        flp = _flp;
        flpManager = _flpManager;
        stakedFlpTracker = _stakedFlpTracker;
        feeFlpTracker = _feeFlpTracker;
    }

    function allowance(address _owner, address _spender) external view returns (uint256) {
        return allowances[_owner][_spender];
    }

    function approve(address _spender, uint256 _amount) external returns (bool) {
        _approve(msg.sender, _spender, _amount);
        return true;
    }

    function transfer(address _recipient, uint256 _amount) external returns (bool) {
        _transfer(msg.sender, _recipient, _amount);
        return true;
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external returns (bool) {
        uint256 nextAllowance = allowances[_sender][msg.sender].sub(_amount, "StakedFlp: transfer amount exceeds allowance");
        _approve(_sender, msg.sender, nextAllowance);
        _transfer(_sender, _recipient, _amount);
        return true;
    }

    function balanceOf(address _account) external view returns (uint256) {
        IRewardTracker(stakedFlpTracker).depositBalances(_account, flp);
    }

    function totalSupply() external view returns (uint256) {
        IERC20(stakedFlpTracker).totalSupply();
    }

    function _approve(address _owner, address _spender, uint256 _amount) private {
        require(_owner != address(0), "StakedFlp: approve from the zero address");
        require(_spender != address(0), "StakedFlp: approve to the zero address");

        allowances[_owner][_spender] = _amount;

        emit Approval(_owner, _spender, _amount);
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) private {
        require(_sender != address(0), "StakedFlp: transfer from the zero address");
        require(_recipient != address(0), "StakedFlp: transfer to the zero address");

        require(
            flpManager.lastAddedAt(_sender).add(flpManager.cooldownDuration()) <= block.timestamp,
            "StakedFlp: cooldown duration not yet passed"
        );

        IRewardTracker(stakedFlpTracker).unstakeForAccount(_sender, feeFlpTracker, _amount, _sender);
        IRewardTracker(feeFlpTracker).unstakeForAccount(_sender, flp, _amount, _sender);

        IRewardTracker(feeFlpTracker).stakeForAccount(_sender, _recipient, flp, _amount);
        IRewardTracker(stakedFlpTracker).stakeForAccount(_recipient, _recipient, feeFlpTracker, _amount);
    }
}
