// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Only the owner can mint. No public mint, payment or metadata-hosting system.
contract OwnerMintNFT is ERC721, Ownable {
    constructor(string memory name_, string memory symbol_, address owner_)
        ERC721(name_, symbol_) Ownable(owner_) {}

    function mint(address recipient_, uint256 tokenId_) external onlyOwner {
        _safeMint(recipient_, tokenId_);
    }
}
