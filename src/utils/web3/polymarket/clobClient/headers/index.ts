import { JsonRpcSigner, Wallet } from "ethers";
import { buildClobEip712Signature, buildPolyHmacSignature } from "../signing";
import {
  ApiKeyCreds,
  Chain,
  L1PolyHeader,
  L2HeaderArgs,
  L2PolyHeader,
} from "../types";

export const createL1Headers = async (
  signer: Wallet | JsonRpcSigner,
  chainId: Chain,
  nonce?: number,
  timestamp?: number
): Promise<L1PolyHeader> => {
  let ts = Math.floor(Date.now() / 1000);
  if (timestamp !== undefined) {
    ts = timestamp;
  }
  let n = 0; // Default nonce is 0
  if (nonce !== undefined) {
    n = nonce;
  }

  const sig = await buildClobEip712Signature(signer, chainId, ts, n);
  const address = await signer.getAddress();

  const headers = {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: sig,
    POLY_TIMESTAMP: `${ts}`,
    POLY_NONCE: `${n}`,
  };
  return headers as L1PolyHeader;
};

export const createL2Headers = async (
  signer: Wallet | JsonRpcSigner,
  creds: ApiKeyCreds,
  l2HeaderArgs: L2HeaderArgs,
  timestamp?: number
): Promise<L2PolyHeader> => {
  let ts = Math.floor(Date.now() / 1000);
  if (timestamp !== undefined) {
    ts = timestamp;
  }
  const address = await signer.getAddress();

  const sig = buildPolyHmacSignature(
    creds.secret,
    ts,
    l2HeaderArgs.method,
    l2HeaderArgs.requestPath,
    l2HeaderArgs.body
  );

  const headers = {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: sig,
    POLY_TIMESTAMP: `${ts}`,
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
  };

  return headers as L2PolyHeader;
};
