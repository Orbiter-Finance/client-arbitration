import { Injectable } from '@nestjs/common';
import { JsonDB, Config } from 'node-json-db';
import { utils, providers, ethers } from 'ethers';
import MDCAbi from '../abi/MDC.abi.json';
import EBCAbi from '../abi/EBC.abi.json';
import {
    ArbitrationTransaction, CheckChallengeParams,
    VerifyChallengeDestParams,
    VerifyChallengeSourceParams,
} from './arbitration.interface';
import { HTTPPost } from '../utils';
import Keyv from 'keyv';
import BigNumber from 'bignumber.js';
import logger from '../utils/logger';
import { keccak256 } from "@ethersproject/keccak256";
import { arbitrationConfig, arbitrationJsonDb } from '../utils/config';

let accountNonce = 0;

const keyv = new Keyv();

export interface ChainRel {
    id: string;
    nativeToken: string;
    minVerifyChallengeSourceTxSecond: string;
    minVerifyChallengeDestTxSecond: string;
    maxVerifyChallengeSourceTxSecond: string;
    maxVerifyChallengeDestTxSecond: string;
    batchLimit: string;
    enableTimestamp: string;
    latestUpdateHash: string;
    latestUpdateBlockNumber: string;
    latestUpdateTimestamp: string;
    spvs: string[];
}

@Injectable()
export class ArbitrationService {
    async querySubgraph(query: string) {
        const subgraphEndpoint = arbitrationConfig.subgraphEndpoint;
        if (!subgraphEndpoint) {
            throw new Error('SubgraphEndpoint not found');
        }
        logger.debug('query', query.replace(/\ +/g,"").replace(/[\r\n]/g," "));
        return HTTPPost(subgraphEndpoint, { query });
    }

    async verifyArbitrationConditions(sourceTx: ArbitrationTransaction): Promise<boolean> {
        // Arbitration time reached
        const chainRels = await this.getChainRels();
        const chain = chainRels.find(c => +c.id === +sourceTx.sourceChainId);
        if (!chain) {
            return false;
        }
        const fromTimestamp = +sourceTx['sourceTxTime'];
        const minVerifyChallengeSourceTime = fromTimestamp + (+chain.minVerifyChallengeSourceTxSecond);
        const maxVerifyChallengeSourceTime = fromTimestamp + (+chain.maxVerifyChallengeSourceTxSecond);
        const nowTime = new Date().valueOf() / 1000;
        return nowTime >= minVerifyChallengeSourceTime && nowTime <= maxVerifyChallengeSourceTime;
    }

    async getMDCs(makerAddress: string) {
        const queryStr = `
          {
              mdcs (where:{
                or:[
                  {
                    owner:"${makerAddress.toLowerCase()}"
                  },
                  {
                    responseMaker_:{
                        id:"${makerAddress.toLowerCase()}"
                    }
                  }
                ]
              }){
                id
                owner
              }
          }
      `;
        const result = await this.querySubgraph(queryStr);
        return result?.data?.mdcs;
    }

    async getChainRels(): Promise<ChainRel[]> {
        let chainRels = await keyv.get('ChainRels');
        if (!chainRels) {
            const queryStr = `
        query  {
            chainRels {
            id
            nativeToken
            minVerifyChallengeSourceTxSecond
            minVerifyChallengeDestTxSecond
            maxVerifyChallengeSourceTxSecond
            maxVerifyChallengeDestTxSecond
            batchLimit
            enableTimestamp
            latestUpdateHash
            latestUpdateBlockNumber
            latestUpdateTimestamp
            spvs
            }
      }
          `;
            const result = await this.querySubgraph(queryStr) || {};
            chainRels = result?.data?.chainRels || [];
            await keyv.set('ChainRels', chainRels, 1000 * 5);
        }
        return chainRels;
    }

    async getChallengeNodeNumber(mdcAddress: string, newChallengeNodeNumber: string) {
        const queryStr = `
        {
            createChallenges(
                where: {
                    challengeNodeNumber_gt: "${newChallengeNodeNumber}"
                    challengeManager_: {
                        mdcAddr: "${mdcAddress}"
                    }
                }
                orderBy: challengeNodeNumber
                orderDirection: asc
                first: 1
            ) {
                challengeNodeNumber
            }
        }
          `;
        const result = await this.querySubgraph(queryStr);
        return result?.data?.createChallenges?.[0]?.challengeNodeNumber;
    }

    async getRule(owner: string, ebcAddress: string, ruleId: string): Promise<{
        chain0,
        chain0CompensationRatio,
        chain0ResponseTime,
        chain0Status,
        chain0Token,
        chain0TradeFee,
        chain0WithholdingFee,
        chain0maxPrice,
        chain0minPrice,
        chain1,
        chain1CompensationRatio,
        chain1ResponseTime,
        chain1Status,
        chain1Token,
        chain1TradeFee,
        chain1WithholdingFee,
        chain1maxPrice,
        chain1minPrice
    } | null> {
        const queryStr = `
        {
            mdcs(where: {owner: "${owner.toLowerCase()}"}) {
              ruleLatest(where: {ebcAddr: "${ebcAddress.toLowerCase()}"}) {
                ruleUpdateRel {
                  ruleUpdateVersion(
                    where: {id: "${ruleId.toLowerCase()}", ruleValidation: true}
                    first: 1
                  ) {
                    chain0
                    chain0CompensationRatio
                    chain0ResponseTime
                    chain0Status
                    chain0Token
                    chain0TradeFee
                    chain0WithholdingFee
                    chain0maxPrice
                    chain0minPrice
                    chain1
                    chain1CompensationRatio
                    chain1ResponseTime
                    chain1Status
                    chain1Token
                    chain1TradeFee
                    chain1WithholdingFee
                    chain1maxPrice
                    chain1minPrice
                  }
                }
              }
            }
          }
          `;
        const result = await this.querySubgraph(queryStr) || {};
        if (result?.data?.mdcs) {
            for (const mdc of result?.data?.mdcs) {
                const ruleLatests = mdc?.ruleLatest;
                if (ruleLatests) {
                    for (const ruleLatest of ruleLatests) {
                        const ruleUpdateRels = ruleLatest?.ruleUpdateRel;
                        if (ruleUpdateRels) {
                            for (const ruleUpdateRel of ruleUpdateRels) {
                                const ruleUpdateVersions = ruleUpdateRel?.ruleUpdateVersion;
                                if (ruleUpdateVersions) {
                                    for (const ruleUpdateVersion of ruleUpdateVersions) {
                                        return ruleUpdateVersion;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // for (const ruleLatest of result?.data?.mdcs?.[0]?.ruleLatest) {
        //     if (ruleLatest?.ruleUpdateRel?.[0]?.ruleUpdateVersion.length) {
        //         return ruleLatest?.ruleUpdateRel?.[0]?.ruleUpdateVersion?.[0];
        //     }
        // }
        return null;
    }

    async getRuleKey(owner: string, ebcAddress: string, ruleId: string) {
        const rule = await this.getRule(owner, ebcAddress, ruleId);
        if (!rule) return null;
        return keccak256(utils.defaultAbiCoder.encode(
            ['uint256', 'uint256', 'uint256', 'uint256'],
            [+rule.chain0, +rule.chain1, +rule.chain0Token, +rule.chain1Token].map(item => ethers.BigNumber.from(item)),
        ));
    }

    async getResponseTime(owner: string, ebcAddress: string, ruleId: string, sourceChain: string, destChain: string) {
        const rule = await this.getRule(owner, ebcAddress, ruleId);
        if (!rule) return null;
        if (+rule.chain0 === +sourceChain && +rule.chain1 === +destChain) {
            return rule.chain0ResponseTime;
        }
        if (+rule.chain0 === +destChain && +rule.chain1 === +sourceChain) {
            return rule.chain1ResponseTime;
        }
        return null;
    }

    async getResponseMakerList(sourceTime: string) {
        const queryStr = `
            {
              mdcs (
                where:{
                  responseMakersSnapshot_:{
                  enableTimestamp_lt:"${sourceTime}"
              }}){
                responseMakersSnapshot {
                  responseMakerList
                }
              }
            }
          `;
        const result = await this.querySubgraph(queryStr);
        const mdcs = result?.data?.mdcs;
        if (mdcs) {
            for(const mdc of mdcs){
                const responseMakersSnapshots = mdc?.responseMakersSnapshot;
                if(responseMakersSnapshots){
                    for(const responseMakersSnapshot of responseMakersSnapshots){
                        const responseMakerList = responseMakersSnapshot?.responseMakerList;
                        if(responseMakerList && responseMakerList.length){
                            return responseMakerList;
                        }
                    }
                }
            }
        }
        return [];
        // return result?.data?.mdcs?.[0]?.responseMakersSnapshot?.[0]?.responseMakerList || [];
    }

    async getColumnArray(txTimestamp: string | number, mdcAddress: string, owner: string) {
        const queryStr = `
   {
        columnArraySnapshots(
            where: {
                enableTimestamp_lt: "${txTimestamp}",
                mdc_: {
                    id: "${mdcAddress.toLowerCase()}"
                    owner: "${owner.toLowerCase()}"
                }
            }
            first: 1
        ) {
            dealers
            ebcs
            chainIds
        }
    }
          `;
        const result = await this.querySubgraph(queryStr);
        const columnArraySnapshots = result?.data?.columnArraySnapshots;
        for (const columnArraySnapshot of columnArraySnapshots) {
            if (columnArraySnapshot) {
                return columnArraySnapshot;
            }
        }
        return null;
        // return result?.data?.columnArraySnapshots?.[0];
    }

    async getVerifyPassChallenger(owner: string) {
        const queryStr = `
                {
                  challengeManagers (where:{
                    owner:"${owner.toLowerCase()}"
                  }){
                    owner
                    verifyPassChallenger
                    challengeStatuses
                    createChallenge {
                      sourceTxHash
                      isVerifyPass
                    }
                  }
                }
          `;
        const result = await this.querySubgraph(queryStr);
        const challengerList = result?.data?.challengeManagers;
        if (!challengerList) return [];
        const list = [];
        for (const challenger of challengerList) {
            if (challenger.challengeStatuses !== 'VERIFY_SOURCE') continue;
            const verifyPassChallenger = challenger.verifyPassChallenger;
            if (!challenger.createChallenge || !verifyPassChallenger) continue;
            const sourceTxHash = (challenger.createChallenge.find(item => item.isVerifyPass))?.sourceTxHash;
            if (!sourceTxHash) continue;
            list.push({ verifyPassChallenger, sourceTxHash });
        }
        return list;
    }

    async getCurrentChallengeHash(owner: string) {
        const queryStr = `
                {
                  createChallenges(
                    where: {
                        challengeManager_: {
                            owner: "${owner.toLowerCase()}"
                        }
                    },orderBy: challengeNodeNumber, orderDirection: asc) {
                    sourceChainId
                    sourceTxBlockNum
                    sourceTxHash
                    challengeId
                    freezeToken
                    challengeManager {
                      owner
                      challengeStatuses
                    }
                  }
                }
          `;
        const result = await this.querySubgraph(queryStr);
        const challengerList = result?.data?.createChallenges;
        if (!challengerList || !challengerList.length) {
            return null;
        }
        const txHashList = [];
        for (const challenger of challengerList) {
            if (challenger?.challengeManager?.challengeStatuses === 'VERIFY_SOURCE') {
                txHashList.push(challenger.sourceTxHash);
            }
        }
        return txHashList;
    }

    async getCheckChallengeParams(owner: string) {
        const queryStr = `
                {
                  createChallenges(
                    where: {
                        challengeManager_: {
                            owner: "${owner.toLowerCase()}"
                        }
                    },orderBy: challengeNodeNumber, orderDirection: asc) {
                    sourceChainId
                    sourceTxBlockNum
                    sourceTxHash
                    challengeId
                    freezeToken
                    challenger
                    createChallengeTimestamp
                    challengeManager {
                      owner
                      challengeStatuses
                      mdcAddr
                    }
                  }
                }
          `;
        const result = await this.querySubgraph(queryStr);
        const challengerList = result?.data?.createChallenges;
        if (!challengerList || !challengerList.length) {
            return null;
        }
        const list = [];
        for (const challenger of challengerList) {
            if (challenger?.challengeManager?.challengeStatuses !== 'LIQUIDATION') {
                list.push({ ...challenger, mdcAddress: challenger.challengeManager.mdcAddr });
            }
        }
        return list;
    }

    async getEBCValue(owner: string, ebcAddress: string, ruleId: string, sourceChain: string, destChain: string, amount: string) {
        const provider = new providers.JsonRpcProvider({
            url: arbitrationConfig.rpc,
        });
        const contractInstance = new ethers.Contract(
            ebcAddress,
            EBCAbi,
            provider,
        );
        const rule = await this.getRule(owner, ebcAddress, ruleId);
        if (!rule) return null;
        let ro;
        if (+rule.chain0 === +sourceChain && +rule.chain1 === +destChain) {
            ro = [
                rule.chain0,
                rule.chain1,
                rule.chain0Status,
                rule.chain0Token,
                rule.chain1Token,
                rule.chain0minPrice,
                rule.chain0maxPrice,
                rule.chain0WithholdingFee,
                rule.chain0TradeFee,
                rule.chain0ResponseTime,
                rule.chain0CompensationRatio,
            ].map(item=>ethers.BigNumber.from(item));
        } else if (+rule.chain0 === +destChain && +rule.chain1 === +sourceChain) {
            ro = [
                rule.chain1,
                rule.chain0,
                rule.chain1Status,
                rule.chain1Token,
                rule.chain0Token,
                rule.chain1minPrice,
                rule.chain1maxPrice,
                rule.chain1WithholdingFee,
                rule.chain1TradeFee,
                rule.chain1ResponseTime,
                rule.chain1CompensationRatio,
            ].map(item=>ethers.BigNumber.from(item));
        } else {
            return null;
        }
        logger.debug('getEBCValue amount', amount, 'ro', ro);
        return await contractInstance.getResponseIntent(ethers.BigNumber.from(amount), ro);
    }

    async getJSONDBData(dataPath) {
        try {
            return await arbitrationJsonDb.getData(dataPath);
        } catch (e) {
            return null;
        }
    }

    async getGasPrice(transactionRequest: any) {
        const provider = new providers.JsonRpcProvider({
            url: arbitrationConfig.rpc,
        });
        if (arbitrationConfig.gasLimit) {
            transactionRequest.gasLimit = ethers.BigNumber.from(arbitrationConfig.gasLimit);
        } else {
            transactionRequest.gasLimit = ethers.BigNumber.from(1000000);
        }

        // try {
        //     transactionRequest.gasLimit = await provider.estimateGas({
        //         from: transactionRequest.from,
        //         to: transactionRequest.to,
        //         data: transactionRequest.data,
        //         value: transactionRequest.value,
        //     });
        // } catch (e) {
        //     logger.error('get gas limit error:', e);
        // }

        if (arbitrationConfig.maxFeePerGas && arbitrationConfig.maxPriorityFeePerGas) {
            transactionRequest.type = 2;
            transactionRequest.maxFeePerGas = ethers.BigNumber.from(arbitrationConfig.maxFeePerGas);
            transactionRequest.maxPriorityFeePerGas = ethers.BigNumber.from(arbitrationConfig.maxPriorityFeePerGas);
        } else {
            try {
                const feeData = await provider.getFeeData();
                if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
                    transactionRequest.type = 2;
                    transactionRequest.maxFeePerGas = feeData.maxFeePerGas;
                    transactionRequest.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
                    delete transactionRequest.gasPrice;
                } else {
                    transactionRequest.gasPrice = Math.max(1500000000, +feeData.gasPrice);
                    logger.info(`Legacy use gasPrice: ${String(transactionRequest.gasPrice)}, gasLimit: ${String(transactionRequest.gasLimit)}`);
                }
            } catch (e) {
                logger.error('get gas price error:', e);
            }
        }

        const gasFee = new BigNumber(String(transactionRequest.gasLimit)).multipliedBy(String(transactionRequest.maxPriorityFeePerGas || 0));
        logger.info(`maxFeePerGas: ${String(transactionRequest.maxFeePerGas)}, maxPriorityFeePerGas: ${String(transactionRequest.maxPriorityFeePerGas)}, gasLimit: ${String(transactionRequest.gasLimit)}`);

        const balance = await provider.getBalance(transactionRequest.from);
        if (new BigNumber(String(balance)).lt(gasFee)) {
            logger.error(`${transactionRequest.from} Insufficient Balance: ${String(balance)} < ${String(gasFee)}`);
            throw new Error('Insufficient Balance');
        }

        return gasFee;
    }

    async getWallet(key?) {
        const arbitrationPrivateKey = key || arbitrationConfig.privateKey;
        if (!arbitrationPrivateKey) {
            throw new Error('arbitrationPrivateKey not config');
        }
        const provider = new providers.JsonRpcProvider({
            url: arbitrationConfig.rpc,
        });
        return new ethers.Wallet(arbitrationPrivateKey).connect(provider);
    }

    async send(to, value, data, acc?) {
        const account = acc || await this.getWallet();
        const chainId = await account.getChainId();
        const nonce = Math.max(await account.getTransactionCount('pending'), accountNonce);
        const transactionRequest = {
            chainId,
            data,
            to,
            value,
            from: account.address,
            nonce,
        };

        const provider = new providers.JsonRpcProvider({
            url: arbitrationConfig.rpc,
        });
        await this.getGasPrice(transactionRequest);
        logger.debug(`transactionRequest: ${JSON.stringify(transactionRequest)}`);
        const signedTx = await account.signTransaction(transactionRequest);
        const txHash = utils.keccak256(signedTx);
        logger.info(`txHash: ${txHash}`);
        const response = await provider.sendTransaction(signedTx);
        accountNonce = nonce + 1;
        return response;
    }

    async confirmTx(hash) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const provider = new providers.JsonRpcProvider({
            url: arbitrationConfig.rpc,
        });
        const receipt = await provider.getTransactionReceipt(hash);
        if (!receipt?.blockNumber) {
            console.log(`${hash} transaction status confirmation in progress ...`);
            return await this.confirmTx(hash);
        }
        return receipt;
    }

    async handleUserArbitration(tx: ArbitrationTransaction) {
        logger.info(`handleUserArbitration begin ${tx.sourceTxHash}`);
        const ifa = new ethers.utils.Interface(MDCAbi);
        const mdcs = await this.getMDCs(tx.sourceMaker);
        if (!mdcs || !mdcs.length) {
            logger.error(`none of MDC, makerAddress: ${tx.sourceMaker}`);
            return;
        }
        let ruleKey;
        let mdcAddress;
        let owner;
        for (const mdc of mdcs) {
            mdcAddress = mdc.id;
            owner = mdc.owner;
            ruleKey = await this.getRuleKey(owner, tx.ebcAddress, tx.ruleId);
            if (ruleKey) break;
        }
        if (!ruleKey) {
            logger.error(`none of ruleKey, owner: ${owner} ebcAddress: ${tx.ebcAddress} ruleId: ${tx.ruleId}`);
            return;
        }
        let newChallengeNodeNumber = '0x';
        for (const item of [+tx.sourceTxTime, +tx.sourceChainId, +tx.sourceTxBlockNum, +tx.sourceTxIndex]) {
            const challengeNode = utils.defaultAbiCoder.encode(
                ['uint64'],
                [item],
            );
            newChallengeNodeNumber += challengeNode.substr(challengeNode.length - 16, 16);
        }
        logger.debug("newChallengeNodeNumber", newChallengeNodeNumber);
        const parentNodeNumOfTargetNode = await this.getChallengeNodeNumber(mdcAddress, newChallengeNodeNumber);
        logger.debug('parentNodeNumOfTargetNode', parentNodeNumOfTargetNode);
        logger.info(`mdcAddress: ${mdcAddress}, owner: ${owner}, parentNodeNumOfTargetNode: ${parentNodeNumOfTargetNode}`);

        const freezeAmount = new BigNumber(tx.freezeAmount1).multipliedBy(2).toFixed(0);
        // Obtaining arbitration deposit
        const encodeData = [
            +tx.sourceTxTime,
            +tx.sourceChainId,
            +tx.sourceTxBlockNum,
            +tx.sourceTxIndex,
            tx.sourceTxHash,
            ruleKey,
            tx.freezeToken,
            ethers.BigNumber.from(freezeAmount),
            ethers.BigNumber.from(parentNodeNumOfTargetNode || 0),
        ];
        logger.debug(`encodeData: ${JSON.stringify(encodeData)}`);
        const data = ifa.encodeFunctionData('challenge', encodeData);
        const sendValue =
            tx.freezeToken === '0x0000000000000000000000000000000000000000' ?
            ethers.BigNumber.from(new BigNumber(freezeAmount).plus(tx.minChallengeDepositAmount || 0).toString()) :
            ethers.BigNumber.from(0);
        const account = await this.getWallet();
        const challenger = account.address;
        logger.debug(`challenger: ${challenger}`);
        const response = await this.send(mdcAddress, sendValue, data);
        logger.debug(`handleUserArbitration tx: ${JSON.stringify(response)}`);
        await arbitrationJsonDb.push(`/arbitrationHash/${tx.sourceTxHash.toLowerCase()}`, {
            challenger,
            fromChainId: tx.sourceChainId,
            submitSourceTxHash: response.hash,
            isNeedProof: 1
        });
        logger.info(`handleUserArbitration send ${tx.sourceTxHash} ${response.hash}`);
        const receipt = await this.confirmTx(response.hash);
        logger.info(`handleUserArbitration success ${JSON.stringify(receipt)}`);
    }

    async userSubmitProof(txData: VerifyChallengeSourceParams) {
        if (!txData.proof) {
            logger.error('proof is empty');
            return;
        }
        logger.info(`userSubmitProof begin ${txData.hash}`);
        const mdcs = await this.getMDCs(txData.sourceMaker);
        if (!mdcs || !mdcs.length) {
            logger.error(`none of MDC, makerAddress: ${txData.sourceMaker}`);
            return;
        }
        let rule: any;
        let mdcAddress;
        let owner;
        for (const mdc of mdcs) {
            mdcAddress = mdc.id;
            owner = mdc.owner;
            rule = await this.getRule(owner, txData.ebcAddress, txData.ruleId);
            if (rule?.chain0) break;
        }
        if (!rule?.chain0) {
            logger.error(`nonce of rule, ${JSON.stringify(txData)}`);
            return;
        }
        logger.info(`mdcAddress: ${mdcAddress}, owner: ${owner}`);
        const columnArray = await this.getColumnArray(txData.sourceTime, mdcAddress, owner);
        if (!columnArray?.dealers) {
            logger.error(`nonce of columnArray, ${JSON.stringify(txData)}`);
            return;
        }
        const { dealers, ebcs, chainIds } = columnArray;
        const ebc = txData.ebcAddress;
        const rawDatas = utils.defaultAbiCoder.encode(
            ['address[]', 'address[]', 'uint64[]', 'address'],
            [dealers, ebcs, chainIds, ebc],
        );
        const formatRule: any[] = [
            rule.chain0,
            rule.chain1,
            rule.chain0Status,
            rule.chain1Status,
            rule.chain0Token,
            rule.chain1Token,
            rule.chain0minPrice,
            rule.chain1minPrice,
            rule.chain0maxPrice,
            rule.chain1maxPrice,
            rule.chain0WithholdingFee,
            rule.chain1WithholdingFee,
            rule.chain0TradeFee,
            rule.chain1TradeFee,
            rule.chain0ResponseTime,
            rule.chain1ResponseTime,
            rule.chain0CompensationRatio,
            rule.chain1CompensationRatio,
        ];
        logger.debug(`formatRule: ${JSON.stringify(formatRule)}`);
        const rlpRuleBytes = utils.RLP.encode(
            formatRule.map((r) => utils.stripZeros(ethers.BigNumber.from(r).toHexString())),
        );

        const ifa = new ethers.utils.Interface(MDCAbi);
        const encodeData = [
            txData.challenger,
            txData.spvAddress,
            +txData.sourceChain,
            txData.proof,
            rawDatas,
            rlpRuleBytes
        ];
        logger.debug(`encodeData: ${JSON.stringify(encodeData)}`);
        const data = ifa.encodeFunctionData('verifyChallengeSource', encodeData);
        const response = await this.send(mdcAddress, ethers.BigNumber.from(0), data);
        logger.debug(`UserSubmitProof tx: ${JSON.stringify(response)}`);
        await arbitrationJsonDb.push(`/arbitrationHash/${txData.hash}`, {
            challenger: txData.challenger,
            submitSourceTxHash: txData.submitSourceTxHash,
            verifyChallengeSourceHash: response.hash,
            isNeedProof: 0
        });
        logger.info(`userSubmitProof end ${txData.hash} ${response.hash}`);
        return response as any;
    }

    async makerSubmitProof(txData: VerifyChallengeDestParams) {
        if (!txData.proof) {
            logger.error('proof is empty');
            return;
        }
        logger.info(`makerSubmitProof begin sourceId: ${txData.sourceId}`);
        const ifa = new ethers.utils.Interface(MDCAbi);
        const chainRels = await this.getChainRels();
        const mdcs = await this.getMDCs(txData.sourceMaker);
        if (!mdcs || !mdcs.length) {
            logger.error(`none of MDC, makerAddress: ${txData.sourceMaker}`);
            return;
        }
        let mdcAddress;
        let owner;
        for (const mdc of mdcs) {
            mdcAddress = mdc.id;
            owner = mdc.owner;
            if (owner) break;
        }
        logger.info(`mdcAddress: ${mdcAddress}, owner: ${owner}`);
        const chain = chainRels.find(c => +c.id === +txData.sourceChain);
        if (!chain) {
            logger.error(`nonce of chainRels, ${JSON.stringify(txData)}`);
            return;
        }
        const responseMakerList = await this.getResponseMakerList(txData.sourceTime);
        logger.debug('responseMakerList', responseMakerList);
        const rawDatas = utils.defaultAbiCoder.encode(
            ['uint256[]'],
            [responseMakerList.map(item => ethers.BigNumber.from(item))],
        );
        const responseMakersHash = utils.keccak256(rawDatas);
        const responseTime = await this.getResponseTime(owner, txData.ebcAddress, txData.ruleId, txData.sourceChain, txData.targetChain);
        if (!responseTime) {
            logger.error(`nonce of responseTime, ${JSON.stringify(txData)}`);
            return;
        }
        const destAmount = await this.getEBCValue(owner, txData.ebcAddress, txData.ruleId, txData.sourceChain, txData.targetChain, txData.sourceAmount);
        if (!destAmount) {
            logger.error(`nonce of destAmount, ${JSON.stringify(txData)}`);
            return;
        }
        logger.debug('verifiedSourceTxData',
            chain.minVerifyChallengeSourceTxSecond,
            chain.maxVerifyChallengeSourceTxSecond,
            txData.sourceNonce,
            txData.targetChain,
            txData.sourceAddress,
            txData.targetToken,
            destAmount,
            responseMakersHash,
            responseTime);
        const verifiedSourceTxData = {
            minChallengeSecond: ethers.BigNumber.from(chain.minVerifyChallengeSourceTxSecond),
            maxChallengeSecond: ethers.BigNumber.from(chain.maxVerifyChallengeSourceTxSecond),
            nonce: ethers.BigNumber.from(txData.sourceNonce),
            destChainId: ethers.BigNumber.from(txData.targetChain),
            from: ethers.BigNumber.from(txData.sourceAddress),
            destToken: ethers.BigNumber.from(txData.targetToken),
            destAmount: ethers.BigNumber.from(destAmount),
            responseMakersHash: ethers.BigNumber.from(responseMakersHash),
            responseTime: ethers.BigNumber.from(responseTime),
        };
        const encodeData = [
            txData.challenger,
            txData.spvAddress,
            txData.sourceChain,
            txData.sourceId,
            txData.proof,
            verifiedSourceTxData,
            rawDatas,
        ];
        logger.debug(`encodeData: ${JSON.stringify(encodeData)}`);
        const data = ifa.encodeFunctionData('verifyChallengeDest', encodeData);
        const response = await this.send(mdcAddress, ethers.BigNumber.from(0), data);
        logger.debug(`MakerSubmitProof tx: ${JSON.stringify(response)}`);
        await arbitrationJsonDb.push(`/arbitrationHash/${txData.sourceId}`, {
            verifyChallengeDestHash: response.hash,
            challenger: txData.challenger,
            isNeedProof: 0
        });
        logger.info(`makerSubmitProof end sourceId: ${txData.sourceId} verifyChallengeDestHash: ${response.hash}`);
        return response as any;
    }

    async checkChallenge(txData: CheckChallengeParams) {
        if (!arbitrationConfig.liquidatePrivateKey) {
            logger.error('liquidatePrivateKey key not injected');
            return { message: 'liquidatePrivateKey key not injected' };
        }
        logger.info(`CheckChallenge begin: ${JSON.stringify(txData)}`);
        const encodeData = [
            txData.sourceChainId,
            txData.sourceTxHash,
            [txData.challenger],
        ];
        logger.debug(`encodeData: ${JSON.stringify(encodeData)}`);
        const ifa = new ethers.utils.Interface(MDCAbi);
        const data = ifa.encodeFunctionData('checkChallenge', encodeData);
        const response = await this.send(txData.mdcAddress, ethers.BigNumber.from(0), data, await this.getWallet(arbitrationConfig.liquidatePrivateKey));
        logger.debug(`CheckChallenge tx: ${JSON.stringify(response)}`);
        await arbitrationJsonDb.push(`/arbitrationHash/${txData.sourceTxHash.toLowerCase()}`, {
            challenger: txData.challenger,
            checkChallengeHash: response.hash,
            isNeedProof: 0
        });
        return response as any;
    }
}
