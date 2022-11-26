// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../tokens/interfaces/IWETH.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/Address.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "./interfaces/IRouter.sol";
import "./interfaces/IVault.sol";

import "../access/Governable.sol";

contract BaseRequestRouter is ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    uint256 public constant PRICE_PRECISION = 10 ** 30;

    address public admin;

    address public vault;
    address public router;
    address public weth;

    uint256 public minExecutionFee;

    uint256 public minBlockDelayKeeper;
    uint256 public minTimeDelayPublic;
    uint256 public maxTimeDelay;

    mapping (address => bool) public isRequestKeeper;

    event SetRequestKeeper(address indexed account, bool isActive);
    event SetMinExecutionFee(uint256 minExecutionFee);
    event SetDelayValues(uint256 minBlockDelayKeeper, uint256 minTimeDelayPublic, uint256 maxTimeDelay);
    event SetAdmin(address admin);

    modifier onlyAdmin() {
        require(msg.sender == admin, "BaseRequestRouter: forbidden");
        _;
    }

    modifier onlyRequestKeeper() {
        require(isRequestKeeper[msg.sender], "BaseRequestRouter: forbidden");
        _;
    }

    constructor(
        address _vault,
        address _router,
        address _weth,
        uint256 _minExecutionFee
    ) public {
        vault = _vault;
        router = _router;
        weth = _weth;
        minExecutionFee = _minExecutionFee;

        admin = msg.sender;
    }

    receive() external payable {
        require(msg.sender == weth, "BaseRequestRouter: invalid sender");
    }

    function approve(address _token, address _spender, uint256 _amount) external onlyGov {
        IERC20(_token).approve(_spender, _amount);
    }

    function sendValue(address payable _receiver, uint256 _amount) external onlyGov {
        _receiver.sendValue(_amount);
    }

    function setAdmin(address _admin) external onlyGov {
        admin = _admin;
        emit SetAdmin(_admin);
    }

    function setRequestKeeper(address _account, bool _isActive) external onlyAdmin {
        isRequestKeeper[_account] = _isActive;
        emit SetRequestKeeper(_account, _isActive);
    }

    function setMinExecutionFee(uint256 _minExecutionFee) external onlyAdmin {
        minExecutionFee = _minExecutionFee;
        emit SetMinExecutionFee(_minExecutionFee);
    }

    function setDelayValues(uint256 _minBlockDelayKeeper, uint256 _minTimeDelayPublic, uint256 _maxTimeDelay) external onlyAdmin {
        minBlockDelayKeeper = _minBlockDelayKeeper;
        minTimeDelayPublic = _minTimeDelayPublic;
        maxTimeDelay = _maxTimeDelay;
        emit SetDelayValues(_minBlockDelayKeeper, _minTimeDelayPublic, _maxTimeDelay);
    }

    function getRequestKey(address _account, uint256 _index) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_account, _index));
    }

    function _validateExecution(uint256 _positionBlockNumber, uint256 _positionBlockTime, address _account) internal view returns (bool) {
        if (_positionBlockTime.add(maxTimeDelay) <= block.timestamp) {
            revert("BaseRequestRouter: request has expired");
        }

        bool isKeeperCall = msg.sender == address(this) || isRequestKeeper[msg.sender];

        if (isKeeperCall) {
            return _positionBlockNumber.add(minBlockDelayKeeper) <= block.number;
        }

        require(msg.sender == _account, "BaseRequestRouter: forbidden");

        require(_positionBlockTime.add(minTimeDelayPublic) <= block.timestamp, "BaseRequestRouter: min delay not yet passed");

        return true;
    }

    function _validateCancellation(uint256 _positionBlockNumber, uint256 _positionBlockTime, address _account) internal view returns (bool) {
        bool isKeeperCall = msg.sender == address(this) || isRequestKeeper[msg.sender];

        if (isKeeperCall) {
            return _positionBlockNumber.add(minBlockDelayKeeper) <= block.number;
        }

        require(msg.sender == _account, "BaseRequestRouter: forbidden");

        require(_positionBlockTime.add(minTimeDelayPublic) <= block.timestamp, "BaseRequestRouter: min delay not yet passed");

        return true;
    }

    function _transferInETH() internal {
        if (msg.value != 0) {
            IWETH(weth).deposit{value: msg.value}();
        }
    }

    function _transferOutETH(uint256 _amountOut, address payable _receiver) internal {
        IWETH(weth).withdraw(_amountOut);
        _receiver.sendValue(_amountOut);
    }

    function _transferOutETHWithGasLimit(uint256 _amountOut, address payable _receiver) internal {
        IWETH(weth).withdraw(_amountOut);
        _receiver.transfer(_amountOut);
    }
}
