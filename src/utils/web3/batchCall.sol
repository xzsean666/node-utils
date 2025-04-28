// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

struct Multicall {
    address target;
    bytes callData;
}
import "@openzeppelin/contracts/utils/Address.sol"; // Import OpenZeppelin's Address library
import "@openzeppelin/contracts/access/Ownable.sol"; // 添加 Ownable 导入

// 0xfFF345ea72436bA6Af24835981C4546B59f7DeAd
contract BatchCall is Ownable {
    mapping(address => bool) public authorizedCallers; // 添加授权地址映射

    event CallResult(address target, bytes data);
    event CallError(address target, string reason);
    event CallerAuthorized(address caller);
    event CallerRevoked(address caller);
    using Address for address;

    constructor() Ownable(msg.sender) {
        authorizedCallers[msg.sender] = true;
    }

    function batchStaticCall(
        Multicall[] calldata calls
    ) external view returns (bool[] memory successes, bytes[] memory results) {
        successes = new bool[](calls.length);
        results = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            require(calls[i].target != address(0), "Invalid target address");
            require(calls[i].callData.length >= 4, "Invalid call data");

            (bool success, bytes memory result) = calls[i].target.staticcall(
                calls[i].callData
            );
            successes[i] = success;
            results[i] = result; // 保留原始返回数据，即使调用失败
        }
    }

    function batchCall(
        Multicall[] calldata calls
    )
        external
        payable
        returns (bool[] memory successes, bytes[] memory results)
    {
        require(authorizedCallers[msg.sender], "Caller not authorized");
        successes = new bool[](calls.length);
        results = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            require(calls[i].target != address(0), "Invalid target address");
            require(calls[i].callData.length >= 4, "Invalid call data");

            (bool success, bytes memory result) = calls[i].target.call(
                calls[i].callData
            );
            successes[i] = success;
            results[i] = result; // 保留原始返回数据，即使调用失败

            if (success) {
                emit CallResult(calls[i].target, result);
            } else {
                // 尝试解码错误信息
                string memory reason = _getRevertMsg(result);
                emit CallError(calls[i].target, reason);
            }
        }
    }

    // 辅助函数：解码revert原因
    function _getRevertMsg(
        bytes memory _returnData
    ) internal pure returns (string memory) {
        if (_returnData.length < 68) return "Transaction reverted silently";

        assembly {
            _returnData := add(_returnData, 0x04)
        }

        return abi.decode(_returnData, (string));
    }

    // 添加授权函数
    function grantAccess(address caller) external onlyOwner {
        require(caller != address(0), "Invalid address");
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    // 添加撤销授权函数
    function revokeAccess(address caller) external onlyOwner {
        require(caller != address(0), "Invalid address");
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }
}
