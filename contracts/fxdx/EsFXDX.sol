// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract EsFXDX is MintableBaseToken {
    constructor() public MintableBaseToken("Escrowed FXDX", "esFXDX", 0) {
    }

    function id() external pure returns (string memory _name) {
        return "esFXDX";
    }
}
