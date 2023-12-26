import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {
    }

    @Get()
    index() {
        return { code: 0, message: 'Welcome to the arbitration system' };
    }

    @Post('/config')
    setConfig(@Body() data: any) {
        if (!data) {
            return { code: 1, message: 'Invalid parameters' };
        }
        return this.appService.setConfig(data);
    }

    @Post('/liquidate')
    liquidate(@Body() data: any) {
        if (!data?.hash) {
            return { code: 1, message: 'Invalid parameters' };
        }
        return this.appService.liquidate(data.hash);
    }

    @Post('/retry_proof')
    retryProof(@Body() data: any) {
        if (!data?.hash) {
            return { code: 1, message: 'Invalid parameters' };
        }
        return this.appService.retryProof(data.hash);
    }
}
