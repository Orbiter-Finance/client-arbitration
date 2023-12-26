import axios from "axios";
import CryptoJS from "crypto-js";

export async function HTTPGet(
  url: string,
  options?: any,
): Promise<any> {
    let response: any;
    try {
        response = await axios.get(url, options);
    } catch (e) {
        console.error('request fail', url);
        throw new Error(e);
    }

    return await response.data;
}

export async function HTTPPost(
  url: string,
  data: any
): Promise<any> {
    const response = await axios.post(url, data);
    return await response.data;
}

const salt = 'b259cc7f56fb2';

export function aesEncrypt(data, secretKey) {
    return CryptoJS.AES.encrypt(data, secretKey + salt)
        .toString()
        .replace(/\+/g, '6wfxxwy6mfd')
        .replace(/\-/g, '51rplcqrzvr')
        .replace(/\=/g, 'vr11nhjxc2')
        .replace(/\//g, 'f9luku98taa');
}

export function aesDecrypt(data, secretKey) {
    return CryptoJS.AES.decrypt(
        data
            .replace(/6wfxxwy6mfd/g, '+')
            .replace(/51rplcqrzvr/g, '-')
            .replace(/vr11nhjxc2/g, '=')
            .replace(/f9luku98taa/g, '/'),
        secretKey + salt,
    ).toString(CryptoJS.enc.Utf8);
}
