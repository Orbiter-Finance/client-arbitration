import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ArbitrationService } from './arbitration.service';
import { ArbitrationTransaction, CheckChallengeParams } from './arbitration.interface';
import { HTTPGet, HTTPPost } from '../utils';
import { arbitrationConfig, arbitrationJsonDb, mutex } from '../utils/config';
import { challengerLogger, commonLogger, liquidatorLogger, Logger, makerLogger } from '../utils/logger';

let versionUpdate = false;

@Injectable()
export class ArbitrationJobService {
    constructor(private arbitrationService: ArbitrationService) {
        this.checkVersion();
        const cron = setInterval(async () => {
            try {
                await this.liquidation();
            } catch (e) {
                clearInterval(cron);
            }
        }, 1000 * 50);
    }

    @Interval(1000 * 40)
    async syncProof() {
        if (versionUpdate) {
            return;
        }
        if (!arbitrationConfig.privateKey) {
            console.log('Private key not injected', arbitrationConfig);
            return;
        }
        const isMaker = !!arbitrationConfig.makerList;
        if (mutex.isLocked()) {
            return;
        }
        const logger: Logger = isMaker ? makerLogger : challengerLogger;
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
                    if (!proofDataList || !proofDataList.length) {
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
        if (versionUpdate) {
            return;
        }
        if (!arbitrationConfig.privateKey) {
            return;
        }
        if (arbitrationConfig.makerList) {
            return;
        }
        if (!arbitrationConfig.watchWalletList) {
            challengerLogger.info(`the watch wallet list not configured`);
            return;
        }
        if (mutex.isLocked()) {
            return;
        }
        mutex.runExclusive(async () => {
            try {
                const url = `${arbitrationConfig.makerApiEndpoint}/transaction/pendingArbitration`;
                const res: any = await HTTPGet(url);
                if (res?.data) {
                    const list: ArbitrationTransaction[] = res?.data?.list || [];
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
                    challengerLogger.debug(`${url} api tx count ${list.length}, wallet tx count ${walletArbitrationTxList.length}`);
                    for (const item of walletArbitrationTxList) {
                        const result = await this.arbitrationService.verifyArbitrationConditions(item);
                        if (result) {
                            const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${item.sourceTxHash.toLowerCase()}`);
                            if (data) {
                                challengerLogger.debug(`${item.sourceTxHash.toLowerCase()} exist`);
                                continue;
                            }
                            try {
                                await this.arbitrationService.handleUserArbitration(item);
                            } catch (error) {
                                challengerLogger.error(`Arbitration encountered an exception: ${JSON.stringify(item)}`, error);
                            }
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        } else {
                            challengerLogger.debug(`verifyArbitrationConditions fail ${JSON.stringify(item)}`);
                        }
                    }
                }
            } catch (e) {
                console.error('userArbitrationJob error', e);
            }
        });
    }

    // makerArbitrationJob
    @Interval(1000 * 30)
    getListOfUnresponsiveTransactions() {
        if (versionUpdate) {
            return;
        }
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
                    try {
                        await this.arbitrationService.checkIllegalChallenges(makerAddress);
                    } catch (e) {
                        makerLogger.error('checkIllegalChallenges error', e);
                    }
                    const challengerList = await this.arbitrationService.getVerifyPassChallenger(makerAddress);
                    for (const challengerData of challengerList) {
                        const hash = challengerData.sourceTxHash.toLowerCase();
                        const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${hash}`);
                        if (data) {
                            makerLogger.debug(`${hash} tx exist`);
                            continue;
                        }
                        const txStatusRes = await HTTPGet(`${arbitrationConfig.makerApiEndpoint}/transaction/status/${hash}`, {
                            hash,
                        });
                        if (txStatusRes?.data !== 99) {
                            makerLogger.debug(`${hash} status ${txStatusRes?.data}`);
                            continue;
                        }
                        const res: any = await HTTPPost(`${arbitrationConfig.makerApiEndpoint}/proof/makerAskProof`, {
                            hash,
                        });
                        if (+res?.errno === 0) {
                            await arbitrationJsonDb.push(`/arbitrationHash/${hash}`, {
                                isNeedProof: 1,
                                challenger: challengerData.verifyPassChallenger,
                            });
                            makerLogger.info(`maker ask proof ${hash}`);
                        } else {
                            makerLogger.error('maker request ask error', res.errmsg);
                        }
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            } catch (e) {
                console.error('makerArbitrationJob error', e);
            }
        });
    }

    @Interval(1000 * 60)
    async checkVersion() {
        const txStatusRes = await HTTPGet(`${arbitrationConfig.makerApiEndpoint}/version`);
        const isMaker = !!arbitrationConfig.makerList;
        const userVersion = txStatusRes?.data?.UserVersion;
        if (userVersion && process.env.UserVersion && !isMaker && userVersion !== process.env.UserVersion) {
            versionUpdate = userVersion.split('.')[0] !== process.env.UserVersion.split('.')[0];
            commonLogger.error('Please pull the latest code from the main branch due to version updates.');
        }
        const makerVersion = txStatusRes?.data?.MakerVersion;
        if (makerVersion && process.env.MakerVersion && isMaker && makerVersion !== process.env.MakerVersion) {
            versionUpdate = makerVersion.split('.')[0] !== process.env.MakerVersion.split('.')[0];
            commonLogger.error('Please pull the latest code from the main branch due to version updates.');
        }
    }

    @Interval(1000 * 30)
    async heartbeat() {
        if (arbitrationConfig.heartbeatApiEndpoint) {
            await HTTPGet(arbitrationConfig.heartbeatApiEndpoint);
        }
    }

    async liquidation() {
        if (!arbitrationConfig.liquidatePrivateKey) {
            return;
        }
        const isMaker = !!arbitrationConfig.makerList;
        if (!isMaker) return;
        if (mutex.isLocked()) {
            return;
        }
        await mutex.runExclusive(async () => {
            try {
                if (arbitrationConfig.makerList instanceof Array) {
                    for (const owner of arbitrationConfig.makerList) {
                        const checkChallengeParamsList: CheckChallengeParams[] = await this.arbitrationService.getCheckChallengeParams(owner);
                        if (checkChallengeParamsList && checkChallengeParamsList.length) {
                            const nextChallengeParams = checkChallengeParamsList[0];
                            const hash = nextChallengeParams.sourceTxHash;
                            if (!hash) return;
                            const liquidationObj = await this.arbitrationService.getLiquidationData('/arbitrationHash') || {};
                            const hashList = Object.keys(liquidationObj);
                            if (hashList.find(item => item.toLowerCase() === hash.toLowerCase())) {
                                liquidatorLogger.debug(`${hash.toLowerCase()} exist`);
                                return;
                            }

                            const chainRels = await this.arbitrationService.getChainRels();
                            const chainRel = chainRels.find(item => +item.id === +nextChallengeParams.sourceChainId);
                            if (!chainRel) {
                                liquidatorLogger.debug(`none of chainRel, sourceChainId: ${nextChallengeParams.sourceChainId}`);
                                return;
                            }
                            if (!nextChallengeParams?.challengeManager?.verifyChallengeSourceTimestamp) {
                                liquidatorLogger.debug(`none of verifyChallengeSourceTimestamp, nextChallengeParams: ${JSON.stringify(nextChallengeParams)}`);
                                return;
                            }
                            const isMakerFail = nextChallengeParams.challengeManager.challengeStatuses === "VERIFY_SOURCE" && new Date().valueOf() > ((+nextChallengeParams?.challengeManager?.verifyChallengeSourceTimestamp + +chainRel.maxVerifyChallengeDestTxSecond) * 1000);
                            const isMakerSuccess = nextChallengeParams.challengeManager.challengeStatuses === 'VERIFY_DEST';
                            const isUserFail1 = nextChallengeParams.challengeManager.challengeStatuses === 'CREATE' && +nextChallengeParams?.challengeManager?.verifyChallengeDestTimestamp !== 0;
                            const isUserFail2 = nextChallengeParams.challengeManager.challengeStatuses === 'CREATE' && new Date().valueOf() > ((+nextChallengeParams.sourceTxTime + +chainRel.maxVerifyChallengeSourceTxSecond) * 1000);
                            if (!isMakerFail && !isMakerSuccess && !isUserFail1 && !isUserFail2) {
                                if (nextChallengeParams.challengeManager.challengeStatuses === 'VERIFY_SOURCE') {
                                    liquidatorLogger.debug(`${hash} failure to meet liquidation conditions, 'VERIFY_SOURCE' await ${
                                        Math.floor((((+nextChallengeParams?.challengeManager?.verifyChallengeSourceTimestamp + +chainRel.maxVerifyChallengeDestTxSecond) * 1000) - new Date().valueOf()) / 1000)
                                    }s`);
                                } else if (nextChallengeParams.challengeManager.challengeStatuses === 'CREATE') {
                                    liquidatorLogger.debug(`${hash} failure to meet liquidation conditions, 'CREATE' await ${
                                        Math.floor((((+nextChallengeParams.sourceTxTime + +chainRel.maxVerifyChallengeSourceTxSecond) * 1000) - new Date().valueOf()) / 1000)
                                    }s`);
                                } else {
                                    liquidatorLogger.debug(`${hash} failure to meet liquidation conditions`);
                                }
                                return;
                            }
                            if (isMakerFail) {
                                liquidatorLogger.info(`MakerFail: ${isMakerFail}, ${new Date().valueOf()} > (${+nextChallengeParams?.challengeManager?.verifyChallengeSourceTimestamp} + ${+chainRel.maxVerifyChallengeDestTxSecond}) * 1000`);
                            }
                            if (isMakerSuccess) {
                                liquidatorLogger.info(`MakerSuccess: ${isMakerSuccess}, challengeStatuses = 'VERIFY_DEST'`);
                            }
                            if (isUserFail1) {
                                liquidatorLogger.info(`UserFail1: ${isUserFail1}, verifyChallengeDestTimestamp = ${+nextChallengeParams?.challengeManager?.verifyChallengeDestTimestamp}`);
                            }
                            if (isUserFail2) {
                                liquidatorLogger.info(`UserFail2: ${isUserFail2}, ${new Date().valueOf()} > (${+nextChallengeParams.sourceTxTime} + ${+chainRel.maxVerifyChallengeSourceTxSecond}) * 1000`);
                            }
                            const checkChallengeParams = checkChallengeParamsList.filter(item => item.sourceTxHash.toLowerCase() === hash.toLowerCase());
                            if (checkChallengeParams && checkChallengeParams.length) {
                                return await this.arbitrationService.checkChallenge(checkChallengeParams);
                            }
                        }
                    }
                    liquidatorLogger.debug('liquidate transaction is not in the pending liquidation list');
                }
            } catch (e) {
                liquidatorLogger.error('liquidate error', e);
                await mutex.release();
                throw new Error(e);
            }
        });
    }
}
