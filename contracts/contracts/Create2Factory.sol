// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal CREATE2 deployer used to place the hook at a mined address.
contract Create2Factory {
    event Deployed(address addr, bytes32 salt);

    function deploy(bytes32 salt, bytes memory initCode) external returns (address addr) {
        assembly {
            addr := create2(0, add(initCode, 0x20), mload(initCode), salt)
            if iszero(addr) {
                let p := mload(0x40)
                returndatacopy(p, 0, returndatasize())
                revert(p, returndatasize())
            }
        }
        emit Deployed(addr, salt);
    }

    function computeAddress(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(
            keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
        )));
    }
}
