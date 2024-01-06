import { Injectable } from '@nestjs/common';
import { ethers, providers } from 'ethers';
import { aesEncrypt, HTTPGet } from './utils';
import { arbitrationConfig, arbitrationJsonDb, configdb, mutex } from './utils/config';
import { ArbitrationService } from './arbitration/arbitration.service';
import { CheckChallengeParams } from './arbitration/arbitration.interface';
import { commonLogger } from './utils/logger';

@Injectable()
export class AppService {
    constructor(private arbitrationService: ArbitrationService) {
    }

    async setConfig(configParams: any) {
        const { privateKey, secretKey, rpc, debug, makerApiEndpoint, makerList, watchWalletList,
            gasLimit, maxFeePerGas, maxPriorityFeePerGas, liquidatePrivateKey, telegramToken, telegramChatId,
        } = configParams;
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
        if (makerApiEndpoint) {
            arbitrationConfig.makerApiEndpoint = makerApiEndpoint;
            try {
                const arbitrationClientConfig = await HTTPGet(`${makerApiEndpoint}/config/arbitration-client`);
                if (arbitrationClientConfig?.data?.subgraphEndpoint) {
                    arbitrationConfig.subgraphEndpoint = arbitrationClientConfig.data.subgraphEndpoint;
                } else {
                    commonLogger.error(`request fail: ${makerApiEndpoint}/config/arbitration-client`, arbitrationClientConfig);
                }
            } catch (e) {
                commonLogger.error(`request fail: ${makerApiEndpoint}/config/arbitration-client`, e);
            }
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

                    try{
                        await HTTPGet(`${arbitrationConfig.makerApiEndpoint}/login`, {
                            address
                        });
                    } catch (e) {
                    }
                } catch (e) {
                    return { code: 1, message: 'PrivateKey error' };
                }
            }
        }
        if (liquidatePrivateKey) {
            if (arbitrationConfig.rpc) {
                try {
                    const provider = new providers.JsonRpcProvider({
                        url: arbitrationConfig.rpc,
                    });
                    const wallet = new ethers.Wallet(liquidatePrivateKey).connect(provider);
                    const address = await wallet.getAddress();
                    console.log(`Inject the ${address} wallet liquidate private key`);
                    arbitrationConfig.secretKey = secretKey ?? arbitrationConfig.secretKey;
                    arbitrationConfig.liquidatePrivateKey = liquidatePrivateKey;
                } catch (e) {
                    return { code: 1, message: 'Liquidate privateKey error' };
                }
            }
        }
        if (makerList) {
            arbitrationConfig.makerList = makerList;
        }
        if (watchWalletList) {
            arbitrationConfig.watchWalletList = watchWalletList;
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
        if (telegramToken) {
            arbitrationConfig.telegramToken = telegramToken;
        }
        if (telegramChatId) {
            arbitrationConfig.telegramChatId = telegramChatId;
        }
        if (debug) {
            arbitrationConfig.debug = +debug;
        }
        const config = JSON.parse(JSON.stringify(arbitrationConfig));
        delete config.privateKey;
        delete config.liquidatePrivateKey;
        if (privateKey) {
            config.encryptPrivateKey = aesEncrypt(privateKey, config.secretKey ?? '');
        }
        if (liquidatePrivateKey) {
            config.encryptLiquidatePrivateKey = aesEncrypt(liquidatePrivateKey, config.secretKey ?? '');
        }
        await configdb.push('/local', config);
        return { code: 0, message: 'success', result: config };
    }

    async liquidate(hash: string) {
        if (!hash) {
            return { code: 1, message: 'Invalid parameters' };
        }
        if (!arbitrationConfig.liquidatePrivateKey) {
            return { code: 1, message: 'liquidatePrivateKey key not injected' };
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
                            if (checkChallengeParamsList && checkChallengeParamsList.length) {
                                const checkChallengeParams = checkChallengeParamsList.filter(item => item.sourceTxHash.toLowerCase() === hash.toLowerCase());
                                if (checkChallengeParams && checkChallengeParams.length) {
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
                    commonLogger.error('liquidate error', e);
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
