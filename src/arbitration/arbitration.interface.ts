export interface ArbitrationTransaction {
    ebcAddress: string;
    ruleId: string;
    sourceMaker: string;
    sourceTxTime: number;
    sourceChainId: number;
    sourceTxBlockNum: number;
    sourceTxIndex: number;
    sourceTxHash: string;
    ruleKey: string;
    freezeToken: string;
    freezeAmount1: string;
    parentNodeNumOfTargetNode: number;
    spvAddress: string;
    minChallengeDepositAmount: string;
}

export interface VerifyChallengeSourceParams {
    hash: string;
    challenger: string;
    sourceTime: string;
    sourceMaker: string;
    ruleId: string;
    spvAddress: string;
    ebcAddress: string;
    sourceChain: string;
    proof: string;
    submitSourceTxHash: string;
}

export interface VerifyChallengeDestParams {
    ebcAddress: string;
    ruleId: string;
    sourceMaker: string;
    sourceTime: string;
    sourceAddress: string;
    sourceNonce: string;
    targetNonce: string;
    targetChain: string;
    targetToken: string;
    sourceAmount: string;
    challenger: string;
    spvAddress: string;
    sourceChain: string;
    sourceId: string;
    proof: string;
}

export interface CheckChallengeParams {
    sourceChainId: string;
    sourceTxHash: string;
    challenger: string;
    mdcAddress: string;
}
