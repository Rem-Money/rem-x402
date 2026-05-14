// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/X402TestToken.sol";

contract Deploy is Script {
    function run() public {
        uint256 deployerKey = vm.envUint("SETTLEMENT_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        string memory name = vm.envOr("TOKEN_NAME", string("Test AUD"));
        string memory symbol = vm.envOr("TOKEN_SYMBOL", string("TAUD"));
        uint8 tokenDecimals = uint8(vm.envOr("TOKEN_DECIMALS", uint256(6)));
        uint256 initialMint = vm.envOr("INITIAL_MINT", uint256(1_000_000));

        vm.startBroadcast(deployerKey);

        X402TestToken impl = new X402TestToken();

        bytes memory initData = abi.encodeCall(
            X402TestToken.initialize,
            (name, symbol, tokenDecimals, deployer)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);

        X402TestToken token = X402TestToken(address(proxy));
        token.mint(deployer, initialMint * 10 ** tokenDecimals);

        vm.stopBroadcast();

        console.log("Implementation:", address(impl));
        console.log("Proxy (use this):", address(proxy));
        console.log("Owner:", deployer);
        console.log("Minted:", initialMint, symbol);
    }
}
