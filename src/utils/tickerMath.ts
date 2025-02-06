export class TickerMath {
  async calculateTokenAmounts(
    liquidity: bigint,
    tickLower: number,
    tickUpper: number,
    sqrtPriceX96: bigint,
    currentTick: number
  ): Promise<{ amount0: bigint; amount1: bigint }> {
    // 确保 sqrtPriceX96 不为0
    if (sqrtPriceX96 <= 0) {
      throw new Error("Invalid sqrtPriceX96");
    }

    const sqrtRatioA = this.getSqrtRatioAtTick(tickLower);
    const sqrtRatioB = this.getSqrtRatioAtTick(tickUpper);
    const sqrtRatioC = sqrtPriceX96;

    let amount0 = BigInt(0);
    let amount1 = BigInt(0);

    if (currentTick < tickLower) {
      // 全部是token0
      amount0 = this.getAmount0ForLiquidity(sqrtRatioA, sqrtRatioB, liquidity);
    } else if (currentTick >= tickUpper) {
      // 全部是token1
      amount1 = this.getAmount1ForLiquidity(sqrtRatioA, sqrtRatioB, liquidity);
    } else {
      // 价格在范围内，计算两种代币
      amount0 = this.getAmount0ForLiquidity(sqrtRatioC, sqrtRatioB, liquidity);
      amount1 = this.getAmount1ForLiquidity(sqrtRatioA, sqrtRatioC, liquidity);
    }

    return { amount0, amount1 };
  }

  private getSqrtRatioAtTick(tick: number): bigint {
    const absTick = Math.abs(tick);
    let ratio: bigint = BigInt(1) << BigInt(96);

    if ((absTick & 0x1) !== 0) {
      ratio = (ratio * BigInt("79232123823359799118286999567")) >> BigInt(96);
    }
    if ((absTick & 0x2) !== 0) {
      ratio = (ratio * BigInt("79236085330515764027303304731")) >> BigInt(96);
    }
    if ((absTick & 0x4) !== 0) {
      ratio = (ratio * BigInt("79244008939048815603706035061")) >> BigInt(96);
    }
    if ((absTick & 0x8) !== 0) {
      ratio = (ratio * BigInt("79259858533276714757314932305")) >> BigInt(96);
    }
    if ((absTick & 0x10) !== 0) {
      ratio = (ratio * BigInt("79291567232598584799939703904")) >> BigInt(96);
    }
    if ((absTick & 0x20) !== 0) {
      ratio = (ratio * BigInt("79355022692464371645785046466")) >> BigInt(96);
    }
    if ((absTick & 0x40) !== 0) {
      ratio = (ratio * BigInt("79482085999252804386437311141")) >> BigInt(96);
    }
    if ((absTick & 0x80) !== 0) {
      ratio = (ratio * BigInt("79736823300114093921829183326")) >> BigInt(96);
    }
    if ((absTick & 0x100) !== 0) {
      ratio = (ratio * BigInt("80248749790819932309965073892")) >> BigInt(96);
    }
    if ((absTick & 0x200) !== 0) {
      ratio = (ratio * BigInt("81282483887344747381513967011")) >> BigInt(96);
    }
    if ((absTick & 0x400) !== 0) {
      ratio = (ratio * BigInt("83390072131320151908154831281")) >> BigInt(96);
    }
    if ((absTick & 0x800) !== 0) {
      ratio = (ratio * BigInt("87770609709833776024991924138")) >> BigInt(96);
    }
    if ((absTick & 0x1000) !== 0) {
      ratio = (ratio * BigInt("97234110755111693312479820773")) >> BigInt(96);
    }
    if ((absTick & 0x2000) !== 0) {
      ratio = (ratio * BigInt("119332217159966728226237229890")) >> BigInt(96);
    }
    if ((absTick & 0x4000) !== 0) {
      ratio = (ratio * BigInt("179736315981702064433883588727")) >> BigInt(96);
    }
    if ((absTick & 0x8000) !== 0) {
      ratio = (ratio * BigInt("407748233172238350107850275304")) >> BigInt(96);
    }
    if ((absTick & 0x10000) !== 0) {
      ratio = (ratio * BigInt("2098478828474011932436660412517")) >> BigInt(96);
    }
    if ((absTick & 0x20000) !== 0) {
      ratio =
        (ratio * BigInt("55581415166113811149459800483533")) >> BigInt(96);
    }
    if ((absTick & 0x40000) !== 0) {
      ratio =
        (ratio * BigInt("38992368544603139932233054999993551")) >> BigInt(96);
    }

    return tick >= 0 ? ratio : (BigInt(1) << BigInt(192)) / ratio;
  }

  private getAmount0ForLiquidity(
    sqrtRatioA: bigint,
    sqrtRatioB: bigint,
    liquidity: bigint
  ): bigint {
    if (sqrtRatioA > sqrtRatioB) {
      [sqrtRatioA, sqrtRatioB] = [sqrtRatioB, sqrtRatioA];
    }

    // 使用更精确的计算方法
    const numerator1 = liquidity << BigInt(96);
    const numerator2 = sqrtRatioB - sqrtRatioA;

    // 避免中间结果溢出，分步计算
    const intermediate = this.mulDiv(numerator1, numerator2, sqrtRatioB);

    return this.mulDiv(intermediate, BigInt(1), sqrtRatioA);
  }

  private getAmount1ForLiquidity(
    sqrtRatioA: bigint,
    sqrtRatioB: bigint,
    liquidity: bigint
  ): bigint {
    if (sqrtRatioA > sqrtRatioB) {
      [sqrtRatioA, sqrtRatioB] = [sqrtRatioB, sqrtRatioA];
    }

    // 直接计算，但使用更精确的方法
    return this.mulDiv(
      liquidity,
      sqrtRatioB - sqrtRatioA,
      BigInt(1) << BigInt(96)
    );
  }

  // 添加辅助方法用于精确的乘除运算
  private mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
    // 检查除数不为零
    if (denominator === BigInt(0)) {
      throw new Error("Division by zero");
    }

    // 计算乘积的高位和低位
    const product = a * b;

    // 如果乘积可能溢出，使用另一种计算方法
    if (product / a !== b) {
      // 使用对数方法或其他替代计算方法
      const aHi = a >> BigInt(128);
      const aLo = a & ((BigInt(1) << BigInt(128)) - BigInt(1));
      const bHi = b >> BigInt(128);
      const bLo = b & ((BigInt(1) << BigInt(128)) - BigInt(1));

      // 分部分计算
      const term1 = aLo * bLo;
      const term2 = aLo * bHi;
      const term3 = aHi * bLo;
      const term4 = aHi * bHi;

      // 重新组合结果
      const result =
        term1 / denominator +
        (term2 << BigInt(128)) / denominator +
        (term3 << BigInt(128)) / denominator +
        (term4 << BigInt(256)) / denominator;

      return result;
    }

    // 如果没有溢出风险，直接计算
    return product / denominator;
  }

  mulShift(val: bigint, mulBy: bigint): bigint {
    return (val * mulBy) >> BigInt(96);
  }

  getSqrtPrice(tick: number): bigint {
    // 实现精确的价格计算
    const alpha = 1.0001; // Uniswap V3 的价格间隔
    const price = Math.pow(alpha, tick / 2);
    return BigInt(Math.floor(price * 2 ** 96));
  }
}
