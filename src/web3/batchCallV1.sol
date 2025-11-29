// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct Multicall {
    address target;
    bytes   callData;
    uint256 value;     // 对子调用转账
    uint256 gasLimit;  // 对子调用限气；0=不限制
}

contract BatchCall is Ownable, ReentrancyGuard {
    mapping(address => bool) public authorizedCallers;

    event CallResult(address indexed target, bool success, bytes32 resultHash, uint256 gasUsed);
    event CallError(address indexed target, string reason);
    event CallerAuthorized(address indexed caller);
    event CallerRevoked(address indexed caller);

    constructor(address initialOwner) Ownable(initialOwner) {
        authorizedCallers[initialOwner] = true;
    }

    function batchStaticCall(Multicall[] calldata calls)
        external
        view
        returns (bool[] memory successes, bytes[] memory results)
    {
        successes = new bool[](calls.length);
        results   = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            require(calls[i].target != address(0), "Invalid target");
            (bool ok, bytes memory ret) = calls[i].target.staticcall(calls[i].callData);
            successes[i] = ok;
            results[i]   = ret;
        }
    }

    function batchCall(Multicall[] calldata calls)
        external
        payable
        nonReentrant
        returns (bool[] memory successes, bytes[] memory results)
    {
        require(authorizedCallers[msg.sender], "Not authorized");

        uint256 sum;
        successes = new bool[](calls.length);
        results   = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            require(calls[i].target != address(0), "Invalid target");
            sum += calls[i].value;
        }
        require(sum == msg.value, "msg.value mismatch");

        for (uint256 i = 0; i < calls.length; i++) {
            uint256 startGas = gasleft();
            (bool ok, bytes memory ret) =
                calls[i].gasLimit == 0
                    ? calls[i].target.call{value: calls[i].value}(calls[i].callData)
                    : calls[i].target.call{value: calls[i].value, gas: calls[i].gasLimit}(calls[i].callData);

            successes[i] = ok;
            results[i]   = ret;

            emit CallResult(calls[i].target, ok, keccak256(ret), startGas - gasleft());

            if (!ok) emit CallError(calls[i].target, _decodeRevert(ret));
        }
    }

    function grantAccess(address caller) external onlyOwner {
        require(caller != address(0), "Invalid address");
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    function revokeAccess(address caller) external onlyOwner {
        require(caller != address(0), "Invalid address");
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }

    function rescueETH(address to, uint256 amount) external onlyOwner {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "rescue failed");
    }

    // 新增：救回 ERC20 代币
    function rescueToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        require(address(token) != address(0), "Invalid token");
        require(to != address(0), "Invalid recipient");
        bool ok = token.transfer(to, amount);
        require(ok, "rescue failed");
    }

    function _decodeRevert(bytes memory data) internal pure returns (string memory) {
        if (data.length < 4) return "reverted (no data)";
        bytes4 selector;
        assembly { selector := mload(add(data, 0x20)) }

        if (selector == 0x08c379a0 && data.length >= 68) { // Error(string)
            bytes memory rest = data[4:];
            (string memory reason) = abi.decode(rest, (string));
            return reason;
        }
        if (selector == 0x4e487b71 && data.length >= 36) { // Panic(uint256)
            uint256 code;
            assembly { code := mload(add(data, 0x24)) }
            return string(abi.encodePacked("panic: 0x", _toHex(code)));
        }
        return "reverted (custom error)";
    }

    function _toHex(uint256 x) private pure returns (bytes memory) {
        bytes16 HEX = "0123456789abcdef";
        bytes memory s = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(x >> (248 - i*8));
            s[2*i]   = HEX[b >> 4];
            s[2*i+1] = HEX[b & 0x0f];
        }
        return s;
    }

    receive() external payable {}
}
