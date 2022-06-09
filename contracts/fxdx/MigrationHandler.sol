//SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "./interfaces/IAmmRouter.sol";
import "./interfaces/IFxdxMigrator.sol";
import "../core/interfaces/IVault.sol";

contract MigrationHandler is ReentrancyGuard {
    using SafeMath for uint256;

    uint256 public constant USDF_PRECISION = 10 ** 18;

    bool public isInitialized;

    address public admin;
    address public ammRouterV1;
    address public ammRouterV2;

    address public vault;

    address public gmt;
    address public xgmt;
    address public usdf;
    address public bnb;
    address public busd;

    mapping (address => mapping (address => uint256)) public refundedAmounts;

    modifier onlyAdmin() {
        require(msg.sender == admin, "MigrationHandler: forbidden");
        _;
    }

    constructor() public {
        admin = msg.sender;
    }

    function initialize(
        address _ammRouterV1,
        address _ammRouterV2,
        address _vault,
        address _gmt,
        address _xgmt,
        address _usdf,
        address _bnb,
        address _busd
    ) public onlyAdmin {
        require(!isInitialized, "MigrationHandler: already initialized");
        isInitialized = true;

        ammRouterV1 = _ammRouterV1;
        ammRouterV2 = _ammRouterV2;

        vault = _vault;

        gmt = _gmt;
        xgmt = _xgmt;
        usdf = _usdf;
        bnb = _bnb;
        busd = _busd;
    }

    function redeemUsdf(
        address _migrator,
        address _redemptionToken,
        uint256 _usdfAmount
    ) external onlyAdmin nonReentrant {
        IERC20(usdf).transferFrom(_migrator, vault, _usdfAmount);
        uint256 amount = IVault(vault).sellUSDF(_redemptionToken, address(this));

        address[] memory path = new address[](2);
        path[0] = bnb;
        path[1] = busd;

        if (_redemptionToken != bnb) {
            path = new address[](3);
            path[0] = _redemptionToken;
            path[1] = bnb;
            path[2] = busd;
        }

        IERC20(_redemptionToken).approve(ammRouterV2, amount);
        IAmmRouter(ammRouterV2).swapExactTokensForTokens(
            amount,
            0,
            path,
            _migrator,
            block.timestamp
        );
    }

    function swap(
        address _migrator,
        uint256 _gmtAmountForUsdf,
        uint256 _xgmtAmountForUsdf,
        uint256 _gmtAmountForBusd
    ) external onlyAdmin nonReentrant {
        address[] memory path = new address[](2);

        path[0] = gmt;
        path[1] = usdf;
        IERC20(gmt).transferFrom(_migrator, address(this), _gmtAmountForUsdf);
        IERC20(gmt).approve(ammRouterV2, _gmtAmountForUsdf);
        IAmmRouter(ammRouterV2).swapExactTokensForTokens(
            _gmtAmountForUsdf,
            0,
            path,
            _migrator,
            block.timestamp
        );

        path[0] = xgmt;
        path[1] = usdf;
        IERC20(xgmt).transferFrom(_migrator, address(this), _xgmtAmountForUsdf);
        IERC20(xgmt).approve(ammRouterV2, _xgmtAmountForUsdf);
        IAmmRouter(ammRouterV2).swapExactTokensForTokens(
            _xgmtAmountForUsdf,
            0,
            path,
            _migrator,
            block.timestamp
        );

        path[0] = gmt;
        path[1] = busd;
        IERC20(gmt).transferFrom(_migrator, address(this), _gmtAmountForBusd);
        IERC20(gmt).approve(ammRouterV1, _gmtAmountForBusd);
        IAmmRouter(ammRouterV1).swapExactTokensForTokens(
            _gmtAmountForBusd,
            0,
            path,
            _migrator,
            block.timestamp
        );
    }

    function refund(
        address _migrator,
        address _account,
        address _token,
        uint256 _usdfAmount
    ) external onlyAdmin nonReentrant {
        address iouToken = IFxdxMigrator(_migrator).iouTokens(_token);
        uint256 iouBalance = IERC20(iouToken).balanceOf(_account);
        uint256 iouTokenAmount = _usdfAmount.div(2); // each FXDX is priced at $2

        uint256 refunded = refundedAmounts[_account][iouToken];
        refundedAmounts[_account][iouToken] = refunded.add(iouTokenAmount);

        require(refundedAmounts[_account][iouToken] <= iouBalance, "MigrationHandler: refundable amount exceeded");

        IERC20(usdf).transferFrom(_migrator, _account, _usdfAmount);
    }
}
