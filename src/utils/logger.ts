import winston from 'winston';
import 'winston-daily-rotate-file';

const { transports, format } = winston;
const { label } = format;
const logLevels: any = {
    levels: {
        emerg: 0,
        alert: 1,
        crit: 2,
        error: 3,
        warning: 4,
        notice: 5,
        info: 6,
        debug: 7,
    },
    colors: {
        emerg: 'red',
        alert: 'red',
        crit: 'red',
        error: 'red',
        warning: 'yellow',
        notice: 'blue',
        info: 'green',
        debug: 'green',
    },
};

import 'winston-daily-rotate-file';
import moment from 'moment';
import * as path from 'path';
import { arbitrationConfig } from './config'; // Add DailyRotateFile to Winston transports
export interface LoggerOptions {
    key?: string;
    dir?: string;
    label?: string;
}

export class LoggerService {
    static services: { [key: string]: winston.Logger } = {};

    static createLogger(options: LoggerOptions = {}) {
        const config = Object.assign(
            {
                key: '',
                dir: `runtime/logs`,
                label: '',
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: '20m',
                maxFiles: '10d',
            },
            options,
        );
        const customFormat = format.printf(options => {
            const { level, label, timestamp, message, ...meta } = options;
            const metaStr = meta && Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `${getFormatDate(
                new Date(timestamp).valueOf(),
            )} [${level.toUpperCase()}] ${label} ${message} ${metaStr}`;
        });
        // const consoleTransport = new transports.Console({
        //     format: format.combine(
        //         format.timestamp({ format: "YYYY/MM/DD HH:mm:ss" }),
        //         label({ label: config.label }),
        //         // format.prettyPrint(),
        //         customFormat,
        //     )
        // });
        const errorFileTransport = new transports.DailyRotateFile({
            filename: `${config.dir}/${!config.key ? '' : config.key + '-'}error-%DATE%.log`,
            datePattern: config.datePattern,
            zippedArchive: config.zippedArchive,
            maxSize: config.maxSize,
            maxFiles: config.maxFiles,
            level: 'error',

            format: format.combine(
                format.timestamp({ format: 'YYYY/MM/DD HH:mm:ss' }),
                format.splat(),
                label({ label: config.label }),
                customFormat,
                // format.json(),
            ),
        });

        const infoFileTransport = new transports.DailyRotateFile({
            filename: `${config.dir}/${!config.key ? '' : config.key + '-'}info-%DATE%.log`,
            datePattern: config.datePattern,
            zippedArchive: config.zippedArchive,
            maxSize: config.maxSize,
            maxFiles: config.maxFiles,
            level: 'info',
            format: format.combine(
                format.timestamp({ format: 'YYYY/MM/DD HH:mm:ss' }),
                format.splat(),
                label({ label: config.label }),
                customFormat,
                // format.json(),
                // format.prettyPrint(),
            ),
        });
        const loggerService = winston.createLogger({
            exitOnError: false,
            levels: logLevels.levels,
            format: format.simple(),
            transports: [errorFileTransport, infoFileTransport],
        });
        LoggerService.services[config.key] = loggerService;
        return loggerService;
    }

    static getLogger(key: string, options: LoggerOptions = {}) {
        return LoggerService.services[key] || LoggerService.createLogger(Object.assign(options, { key }));
    }
}

const dir = path.join(__dirname, `../../runtime/mtx`);
const logger = LoggerService.getLogger('arbitration', {
    dir,
});

export default {
    info(...msg) {
        const message = msg.join(' ');
        console.log(`${getFormatDate()} [INFO] \x1B[32m%s\x1b[39m`, message);
        logger.info(message);
    },
    error(...msg) {
        const message = msg.join(' ');
        console.log(`${getFormatDate()} [ERROR] \x1B[31m%s\x1b[39m`, message);
        logger.error(message);
    },
    debug(...msg) {
        if (!arbitrationConfig.debug) return;
        const message = msg.join(' ');
        console.log(`${getFormatDate()} [DEBUG] \x1B[34m%s\x1b[39m`, message);
        logger.info(message);
    },
    input(...msg) {
        const message = msg.join(' ');
        console.log(`${getFormatDate()} [INPUT]`, message);
    },
};

function getFormatDate(date?) {
    const timestamp = new Date(date || new Date().valueOf());
    return moment(timestamp).utcOffset(getTimeZoneString(0)).format('YYYY-MM-DD HH:mm:ss');
}

function getTimeZoneString(timeZone) {
    return `${timeZone < 0 ? '-' : '+'}${Math.abs(timeZone) < 10 ? '0' + Math.abs(timeZone) : Math.abs(timeZone)}:00`;
}
