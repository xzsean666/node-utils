import { ethers } from "ethers";

export class AnvilForkHelper {
  forkUrl: string;
  private provider: ethers.JsonRpcProvider;

  constructor(forkUrl: string = "http://localhost:8545") {
    this.forkUrl = forkUrl;
    this.provider = new ethers.JsonRpcProvider(forkUrl);
  }

  public async deployContract(
    abi: any[],
    bytecode: string,
    wallet: ethers.Wallet
  ): Promise<any> {
    try {
      // 验证钱包状态
      const address = wallet.address;
      const balance = await this.provider.getBalance(address);
      const nonce = await this.provider.getTransactionCount(address);

      console.log("部署前状态检查:");
      console.log(`- 部署者地址: ${address}`);
      console.log(`- 当前余额: ${ethers.formatEther(balance)} ETH`);
      console.log(`- 当前 Nonce: ${nonce}`);

      // 验证是否仍在模拟状态
      try {
        await this.provider.send("anvil_impersonateAccount", [address]);
      } catch (e) {
        console.log("重新启动模拟账户");
      }

      // 创建合约工厂
      const factory = new ethers.ContractFactory(abi, bytecode, wallet);

      // 估算部署 gas
      const deployTx = await factory.getDeployTransaction();
      const estimatedGas = await this.provider.estimateGas(deployTx);
      console.log(`- 估算 Gas: ${estimatedGas}`);

      // 部署合约
      const contract = await factory.deploy();
      await contract.waitForDeployment();

      console.log(`合约已部署到: ${await contract.getAddress()}`);
      return contract;
    } catch (error) {
      console.error("部署错误详细信息:", error);
      throw new Error(`部署合约失败: ${error}`);
    }
  }

  // 新增方法：铸造 ETH
  public async mintETH(
    address: string,
    amount: string | bigint | number
  ): Promise<void> {
    try {
      // 验证地址
      if (!ethers.isAddress(address)) {
        throw new Error("Invalid address format");
      }

      // 获取当前余额
      const currentBalance = await this.provider.getBalance(address);

      // 处理和验证金额
      let amountBigInt: bigint;
      if (typeof amount === "string") {
        try {
          amountBigInt = ethers.parseEther(amount);
        } catch {
          amountBigInt = BigInt(amount);
        }
      } else if (typeof amount === "number") {
        amountBigInt = ethers.parseEther(amount.toString());
      } else {
        amountBigInt = amount;
      }

      if (amountBigInt <= 0n) {
        throw new Error("Amount must be greater than 0");
      }

      // 设置新余额
      const newBalance = currentBalance + amountBigInt;
      await this.provider.send("anvil_setBalance", [
        address,
        "0x" + newBalance.toString(16),
      ]);

      console.log(
        `ETH Minting Details:
        - Address: ${address}
        - Amount Minted: ${ethers.formatEther(amountBigInt)} ETH
        - Previous Balance: ${ethers.formatEther(currentBalance)} ETH
        - New Balance: ${ethers.formatEther(newBalance)} ETH`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Mint ETH failed: ${errorMessage}`);
    }
  }

  // 新增方法：铸造指定 Token
  private async findBalanceSlot(
    tokenAddress: string,
    testAddress: string = "0x0000000000000000000000000000000000000001"
  ): Promise<number> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ["function balanceOf(address) view returns (uint256)"],
      this.provider
    );

    // 测试金额
    const testAmount = 1000000n;

    // 尝试前10个槽位
    for (let slot = 0; slot < 10; slot++) {
      try {
        // 计算存储位置
        const encodedKey = ethers.keccak256(
          ethers.concat([
            ethers.zeroPadValue(testAddress, 32),
            ethers.zeroPadValue(ethers.toBeHex(slot), 32),
          ])
        );

        // 记录原始值
        const originalValue = await this.readStorageSlot(
          tokenAddress,
          encodedKey
        );

        // 设置测试值
        await this.provider.send("anvil_setStorageAt", [
          tokenAddress,
          encodedKey,
          ethers.zeroPadValue(ethers.toBeHex(testAmount), 32),
        ]);

        // 验证余额
        const balance = await tokenContract.balanceOf(testAddress);

        // 恢复原始值
        await this.provider.send("anvil_setStorageAt", [
          tokenAddress,
          encodedKey,
          originalValue,
        ]);

        // 如果余额匹配测试金额，说明找到了正确的槽位
        if (balance === testAmount) {
          console.log(`Found balance slot: ${slot}`);
          return slot;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error("Could not find balance slot");
  }

  public async mintToken(
    tokenAddress: string,
    to: string,
    amount: string | bigint | number
  ): Promise<void> {
    try {
      // 验证地址
      if (!ethers.isAddress(tokenAddress) || !ethers.isAddress(to)) {
        throw new Error("Invalid address format");
      }

      // 处理金额
      let amountBigInt: bigint;
      if (typeof amount === "string") {
        try {
          amountBigInt = ethers.parseUnits(amount, 18);
        } catch {
          amountBigInt = BigInt(amount);
        }
      } else if (typeof amount === "number") {
        amountBigInt = ethers.parseUnits(amount.toString(), 18);
      } else {
        amountBigInt = amount;
      }

      if (amountBigInt <= 0n) {
        throw new Error("Amount must be greater than 0");
      }

      // 自动查找正确的存储槽位
      const balanceSlot = await this.findBalanceSlot(tokenAddress);

      // 计算特定地址的余额存储位置
      const encodedKey = ethers.keccak256(
        ethers.concat([
          ethers.zeroPadValue(to, 32),
          ethers.zeroPadValue(ethers.toBeHex(balanceSlot), 32),
        ])
      );

      // 读取修改前的值
      const beforeValue = await this.readStorageSlot(tokenAddress, encodedKey);
      console.log("Storage value before:", beforeValue);

      // 设置代币余额
      await this.provider.send("anvil_setStorageAt", [
        tokenAddress,
        encodedKey,
        ethers.zeroPadValue(ethers.toBeHex(amountBigInt), 32),
      ]);

      // 读取修改后的值
      const afterValue = await this.readStorageSlot(tokenAddress, encodedKey);
      console.log("Storage value after:", afterValue);

      // 获取余额进行验证
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function balanceOf(address) view returns (uint256)"],
        this.provider
      );

      const newBalance = await tokenContract.balanceOf(to);

      console.log(
        `Token Minting Details:
        - Token Address: ${tokenAddress}
        - To Address: ${to}
        - Amount Minted: ${ethers.formatUnits(amountBigInt, 18)}
        - Storage Slot: ${encodedKey}
        - Verified Balance: ${ethers.formatUnits(newBalance, 18)}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Mint token failed: ${errorMessage}`);
    }
  }

  // 新增辅助方法：读取存储槽位
  private async readStorageSlot(
    contractAddress: string,
    slot: string
  ): Promise<string> {
    return await this.provider.send("eth_getStorageAt", [
      contractAddress,
      slot,
      "latest",
    ]);
  }

  // 新增方法：增加区块
  public async increaseBlock(count: number): Promise<void> {
    try {
      const params = [count];
      await this.provider.send("anvil_mine", params);
    } catch (error) {
      throw new Error(`Increase block failed: ${error}`);
    }
  }

  // 新增方法：减少区块
  public async decreaseBlock(count: number): Promise<void> {
    try {
      const params = [count];
      await this.provider.send("anvil_rollBack", params);
    } catch (error) {
      throw new Error(`Decrease block failed: ${error}`);
    }
  }

  // 新增方法：获取当前区块信息
  public async getCurrentBlock(): Promise<any> {
    try {
      const block = await this.provider.getBlock("latest");
      return block;
    } catch (error) {
      throw new Error(`Get current block failed: ${error}`);
    }
  }
}

// ... existing code ...
