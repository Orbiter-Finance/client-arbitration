import { Config, JsonDB } from 'node-json-db';
import { aesDecrypt } from './index';
import { Mutex } from 'async-mutex';

export let arbitrationConfig: {
    privateKey?: string, secretKey?: string, rpc?: string, debug?: number,
    makerApiEndpoint?: string, subgraphEndpoint?: string, makerList?: string[],
    gasLimit?: string, maxFeePerGas?: string, maxPriorityFeePerGas?: string
} = {};

export const configdb = new JsonDB(new Config('runtime/config', true, false, '/'));

export const arbitrationJsonDb = new JsonDB(new Config('runtime/arbitrationDB', true, false, '/'));

export const mutex = new Mutex();

async function initConfig() {
    try {
        const localConfig = await configdb.getData('/local') || {};
        arbitrationConfig = localConfig;
        if (localConfig.encryptPrivateKey) {
            arbitrationConfig.privateKey = aesDecrypt(localConfig.encryptPrivateKey, localConfig.secretKey || '');
        }
    } catch (e) {
    }
}

initConfig();
