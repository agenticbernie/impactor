// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed supply, 18 decimals. No owner authority, public mint or claim function.
contract FixedSupplyToken is ERC20 {
    constructor(string memory name_, string memory symbol_, address recipient_, uint256 supply_)
        ERC20(name_, symbol_)
    {
        _mint(recipient_, supply_);
    }
}
