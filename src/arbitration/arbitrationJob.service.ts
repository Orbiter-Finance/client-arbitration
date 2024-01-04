import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ArbitrationService } from './arbitration.service';
import { ArbitrationTransaction } from './arbitration.interface';
import { HTTPGet, HTTPPost } from '../utils';
import logger from '../utils/logger';
import { arbitrationConfig, arbitrationJsonDb, mutex } from '../utils/config';

let startTime = new Date().valueOf();

@Injectable()
export class ArbitrationJobService {
    constructor(private arbitrationService: ArbitrationService) {
    }

    @Interval(1000 * 40)
    async syncProof() {
        if (!arbitrationConfig.privateKey) {
            console.log('Private key not injected', arbitrationConfig);
            return;
        }
        const isMaker = !!arbitrationConfig.makerList;
        if (mutex.isLocked()) {
            return;
        }
        await mutex.runExclusive(async () => {
            try {
                let verifySourceHashList: string[] = [];
                if (isMaker && arbitrationConfig.makerList instanceof Array) {
                    for (const owner of arbitrationConfig.makerList) {
                        verifySourceHashList = await this.arbitrationService.getCurrentChallengeHash(owner);
                        if (verifySourceHashList && verifySourceHashList.length) {
                            logger.debug(`The current verifiable Tx ${verifySourceHashList.join(', ')}`);
                        } else {
                            logger.debug(`No verifiable Tx`);
                            return;
                        }
                    }
                }
                const arbitrationObj = await this.arbitrationService.getJSONDBData(`/arbitrationHash`);
                for (const key in arbitrationObj) {
                    if (arbitrationObj[key] && !arbitrationObj[key].isNeedProof) continue;
                    const hash = String(key).toLowerCase();
                    if (isMaker) {
                        const sourceTxHash = verifySourceHashList.find(item => item.toLowerCase() === String(hash).toLowerCase());
                        if (sourceTxHash) {
                            logger.debug(`createChallenges sourceTxHash ${sourceTxHash}`);
                        } else {
                            logger.debug(`${hash} is not in the verifiable list`);
                            continue;
                        }
                    }
                    const url = `${arbitrationConfig.makerApiEndpoint}/proof/${isMaker ? 'verifyChallengeDestParams' : 'verifyChallengeSourceParams'}/${hash}`;
                    const result: any = await HTTPGet(url);
                    const proofDataList: any[] = result?.data;
                    if (!proofDataList.length) {
                        logger.debug(`The interface does not return a list of ${hash} proofs`);
                        continue;
                    }
                    const proofData = proofDataList.find(item => item.status);
                    if (proofData) {
                        if (!proofData?.proof) {
                            logger.error(`No proof found ${hash}`);
                            continue;
                        }
                        if (isMaker) {
                            await this.arbitrationService.makerSubmitProof({
                                ...proofData,
                                challenger: arbitrationObj[hash].challenger,
                            });
                        } else {
                            await this.arbitrationService.userSubmitProof({
                                ...proofData,
                                challenger: arbitrationObj[hash].challenger,
                                submitSourceTxHash: arbitrationObj[hash].submitSourceTxHash,
                            });
                        }
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    } else {
                        logger.debug(`No ${hash} available proof`);
                    }
                }
            } catch (e) {
                logger.error('syncProof error', e);
            }
        });
    }

    // userArbitrationJob
    @Interval(1000 * 30)
    getListOfUnrefundedTransactions() {
        if (!arbitrationConfig.privateKey) {
            return;
        }
        if (arbitrationConfig.makerList) {
            return;
        }
        if (!arbitrationConfig.watchWalletList) {
            logger.info(`the watch wallet list not configured`);
            return;
        }
        if (mutex.isLocked()) {
            return;
        }
        mutex.runExclusive(async () => {
            try {
                const endTime = new Date().valueOf();
                const url = `${arbitrationConfig.makerApiEndpoint}/transaction/unreimbursedTransactions?startTime=${startTime - 1000 * 60 * 60}&endTime=${endTime}`;
                const res: any = await HTTPGet(url);
                if (res?.data) {
                    const list: ArbitrationTransaction[] = res.data;
                    const walletArbitrationTxList = [];
                    if (!arbitrationConfig.watchWalletList.find(item => item === '*')) {
                        for (const data of list) {
                            if (arbitrationConfig.watchWalletList.find(item => item.toLowerCase() === data?.sourceAddress?.toLowerCase())) {
                                walletArbitrationTxList.push(data);
                            }
                        }
                    } else {
                        walletArbitrationTxList.push(...list);
                    }
                    logger.debug(`${url} api tx count ${list.length}, wallet tx count ${walletArbitrationTxList.length}`);
                    for (const item of walletArbitrationTxList) {
                        const result = await this.arbitrationService.verifyArbitrationConditions(item);
                        if (result) {
                            const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${item.sourceTxHash.toLowerCase()}`);
                            if (data) {
                                logger.debug(`${item.sourceTxHash.toLowerCase()} exist`);
                                continue;
                            }
                            try {
                                await this.arbitrationService.handleUserArbitration(item);
                            } catch (error) {
                                logger.error(`Arbitration encountered an exception: ${JSON.stringify(item)}`, error);
                            }
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        } else {
                            logger.debug(`verifyArbitrationConditions fail ${JSON.stringify(item)}`);
                        }
                    }
                    startTime = endTime;
                }
            } catch (e) {
                console.error('userArbitrationJob error', e);
            }
        });
    }

    // makerArbitrationJob
    @Interval(1000 * 30)
    getListOfUnresponsiveTransactions() {
        if (!arbitrationConfig.privateKey) {
            return;
        }
        if (!arbitrationConfig.makerList) {
            return;
        }
        const makerList = arbitrationConfig.makerList;
        if (mutex.isLocked()) {
            return;
        }
        mutex.runExclusive(async () => {
            try {
                for (const makerAddress of makerList) {
                    const challengerList = await this.arbitrationService.getVerifyPassChallenger(makerAddress);
                    for (const challengerData of challengerList) {
                        const hash = challengerData.sourceTxHash.toLowerCase();
                        const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${hash}`);
                        if (data) {
                            logger.debug(`${hash} tx exist`);
                            continue;
                        }
                        const txStatusRes = await HTTPGet(`${arbitrationConfig.makerApiEndpoint}/transaction/status/${hash}`, {
                            hash,
                        });
                        if (txStatusRes?.data !== 99) {
                            logger.debug(`${hash} status ${txStatusRes?.data}`);
                            continue;
                        }
                        const res: any = await HTTPPost(`${arbitrationConfig.makerApiEndpoint}/proof/makerAskProof`, {
                            hash,
                        });
                        if (+res.errno === 0) {
                            await arbitrationJsonDb.push(`/arbitrationHash/${hash}`, {
                                isNeedProof: 1,
                                challenger: challengerData.verifyPassChallenger,
                            });
                            logger.info(`maker ask proof ${hash}`);
                        } else {
                            logger.error('maker request ask error', res.errmsg);
                        }
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            } catch (e) {
                console.error('makerArbitrationJob error', e);
            }
        });
    }
}
