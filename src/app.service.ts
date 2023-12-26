import { Injectable } from '@nestjs/common';
import { ethers, providers } from 'ethers';
import { aesEncrypt, HTTPGet } from './utils';
import logger from './utils/logger';
import { arbitrationConfig, arbitrationJsonDb, configdb, mutex } from './utils/config';
import { ArbitrationService } from './arbitration/arbitration.service';
import { CheckChallengeParams } from './arbitration/arbitration.interface';

@Injectable()
export class AppService {
    constructor(private arbitrationService: ArbitrationService) {
    }

    async setConfig(configParams: any) {
        const { privateKey, secretKey, rpc, debug, makerApiEndpoint, makerList, gasLimit, maxFeePerGas, maxPriorityFeePerGas } = configParams;
        if (rpc) {
            try {
                const provider = new providers.JsonRpcProvider({
                    url: rpc,
                });
                const rpcNetwork = await provider.getNetwork();
                if (+rpcNetwork.chainId !== 11155111 && +rpcNetwork.chainId !== 1) {
                    return { code: 1, message: 'Currently only the main and sepolia networks are supported' };
                }
            } catch (e) {
                return { code: 1, message: 'Rpc error' };
            }
            arbitrationConfig.rpc = rpc;
        }
        if (privateKey) {
            if (arbitrationConfig.rpc) {
                try {
                    const provider = new providers.JsonRpcProvider({
                        url: arbitrationConfig.rpc,
                    });
                    const wallet = new ethers.Wallet(privateKey).connect(provider);
                    const address = await wallet.getAddress();
                    console.log(`Inject the ${address} wallet private key`);
                    arbitrationConfig.secretKey = secretKey ?? arbitrationConfig.secretKey;
                    arbitrationConfig.privateKey = privateKey;
                } catch (e) {
                    return { code: 1, message: 'PrivateKey error' };
                }
            }
        }
        if (makerList) {
            arbitrationConfig.makerList = makerList;
        }
        if (gasLimit) {
            arbitrationConfig.gasLimit = gasLimit;
        }
        if (maxFeePerGas) {
            arbitrationConfig.maxFeePerGas = maxFeePerGas;
        }
        if (maxPriorityFeePerGas) {
            arbitrationConfig.maxPriorityFeePerGas = maxPriorityFeePerGas;
        }
        if (debug) {
            arbitrationConfig.debug = +debug;
        }
        if (makerApiEndpoint) {
            arbitrationConfig.makerApiEndpoint = makerApiEndpoint;
            try {
                const arbitrationClientConfig = await HTTPGet(`${makerApiEndpoint}/config/arbitration-client`);
                if (arbitrationClientConfig?.data?.subgraphEndpoint) {
                    arbitrationConfig.subgraphEndpoint = arbitrationClientConfig.data.subgraphEndpoint;
                } else {
                    logger.error(`request fail: ${makerApiEndpoint}/config/arbitration-client`, arbitrationClientConfig);
                }
            } catch (e) {
                logger.error(`request fail: ${makerApiEndpoint}/config/arbitration-client`, e);
            }
        }
        const config = JSON.parse(JSON.stringify(arbitrationConfig));
        delete config.privateKey;
        if (privateKey) {
            config.encryptPrivateKey = aesEncrypt(privateKey, config.secretKey ?? '');
        }
        await configdb.push('/local', config);
        return { code: 0, message: 'success', result: config };
    }

    async liquidate(hash: string) {
        if (!hash) {
            return { code: 1, message: 'Invalid parameters' };
        }
        if (!arbitrationConfig.privateKey) {
            return { code: 1, message: 'Private key not injected' };
        }
        const isMaker = !!arbitrationConfig.makerList;
        if (!isMaker) return;
        if (mutex.isLocked()) {
            return { code: 1, message: 'Transaction is being sent, please request later' };
        }
        const result = await new Promise(async (resolve) => {
            await mutex.runExclusive(async () => {
                try {
                    if (arbitrationConfig.makerList instanceof Array) {
                        for (const owner of arbitrationConfig.makerList) {
                            const checkChallengeParamsList: CheckChallengeParams[] = await this.arbitrationService.getCheckChallengeParams(owner);
                            if (checkChallengeParamsList) {
                                const checkChallengeParams = checkChallengeParamsList.find(item => item.sourceTxHash.toLowerCase() === hash.toLowerCase());
                                if (checkChallengeParams) {
                                    resolve({
                                        code: 0,
                                        result: await this.arbitrationService.checkChallenge(checkChallengeParams),
                                    });
                                }
                            }
                        }
                        resolve({ code: 1, message: 'Transaction is not in the pending liquidation list' });
                    }
                } catch (e) {
                    logger.error('liquidate error', e);
                }
                resolve({ code: 1, message: 'Send Failure' });
            });
        });
        await mutex.release();
        return result;
    }

    async retryProof(hash: string) {
        if (!hash) {
            return { code: 1, message: 'Invalid parameters' };
        }
        const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${hash.toLowerCase()}`);
        if (!data) {
            return {
                code: 1,
                message: `Please check if the transaction(${hash}) exists under runtime/attritionDB.json`,
            };
        }
        data.isNeedProof = 1;
        await arbitrationJsonDb.push(`/arbitrationHash/${hash.toLowerCase()}`, data);
        return { code: 0, message: 'success', result: data };
    }
}
