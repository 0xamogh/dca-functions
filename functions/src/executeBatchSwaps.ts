import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { BigNumber, ethers } from "ethers";
import DCA_CASH_ABI from "./utils/abi/DcaCash.abi.json";

import {
  CLAIM_BATCH_SIZE,
  CANTO_RPC,
  DCA_CASH_ADDRESS,
  DCA_ORDERS_COLLECTION,
  MAX_MEMORY_AND_TIMEOUT_RUNTIME_AND_SECRET_OPTIONS,
} from "./constants";

export default functions
  .runWith(
    MAX_MEMORY_AND_TIMEOUT_RUNTIME_AND_SECRET_OPTIONS as functions.RuntimeOptions
  )
  .pubsub.schedule("every 1 minutes")
  .onRun(async () => {
    let response;
    const snapshot = await admin
      .firestore()
      .collection(DCA_ORDERS_COLLECTION)
      .get();

    if (snapshot.empty) {
      return;
    }

    const provider = new ethers.providers.JsonRpcProvider(CANTO_RPC);
    const gasAccount = new ethers.Wallet(process.env.PK_1!, provider);
    const batchClaimer = new ethers.Contract(
      DCA_CASH_ADDRESS,
      DCA_CASH_ABI,
      gasAccount
    );

    let user: any[] = [];
    let tokenIn: any[] = [];
    let tokenOut: any[] = [];
    let amountIn: any[] = [];
    let resetTime: any[] = [];
    let docIds: any[] = [];
    for (let i in snapshot.docs) {
      const doc = snapshot.docs[i];
      if (
        admin.firestore.Timestamp.now().seconds - doc.data()["lastExecuted"] >
        doc.data()["resetTime"]
      ) {
        user.push(doc.data()["user"]);
        tokenIn.push(doc.data()["tokenInAddress"]);
        tokenOut.push(doc.data()["tokenOutAddress"]);
        amountIn.push(doc.data()["amountIn"]);
        resetTime.push(doc.data()["resetTime"]);
        docIds.push(doc.id);
      }
    }

    console.log(`batch swap for a total of ${user.length} addresses`);

    // address = batchArray(address, CLAIM_BATCH_SIZE);0
    user = batchArray(user, CLAIM_BATCH_SIZE);
    tokenIn = batchArray(tokenIn, CLAIM_BATCH_SIZE);
    tokenOut = batchArray(tokenOut, CLAIM_BATCH_SIZE);
    amountIn = batchArray(amountIn, CLAIM_BATCH_SIZE);
    resetTime = batchArray(resetTime, CLAIM_BATCH_SIZE);
    docIds = batchArray(docIds, CLAIM_BATCH_SIZE);

    for (let i = 0; i < user.length; i++) {
      let maxFeePerGas, maxPriorityFeePerGas;

      const feeData = await provider.getFeeData();
      console.log(
        "🚀 ~ file:executeSwapBatches.ts:86 ~ .onRun ~ feeData",
        feeData
      );
      maxFeePerGas = feeData.maxFeePerGas!;
      maxFeePerGas = maxFeePerGas.add(maxFeePerGas.div(BigNumber.from(4)));

      maxPriorityFeePerGas = feeData.maxPriorityFeePerGas!;
      maxPriorityFeePerGas = maxPriorityFeePerGas.add(
        maxPriorityFeePerGas.div(BigNumber.from(4))
      );

      try {
        const tx = await batchClaimer.swapBatcher(
          user[i],
          tokenIn[i],
          tokenOut[i],
          amountIn[i],
          resetTime[i],
          maxFeePerGas && maxPriorityFeePerGas
            ? { maxFeePerGas, maxPriorityFeePerGas }
            : {}
        );

        response = await tx.wait();
      } catch (e) {
        console.error("error", e);
        return e;
      }
      for (let j in docIds[i]) {
        await admin
          .firestore()
          .collection(DCA_ORDERS_COLLECTION)
          .doc(docIds[i][j])
          .update({
            lastExecuted: admin.firestore.Timestamp.now().seconds,
          });
      }
    }

    return response;
  });

function batchArray<T>(array: T[], batchSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    result.push(array.slice(i, i + batchSize));
  }
  return result;
}
