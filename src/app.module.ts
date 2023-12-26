import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ArbitrationModule } from './arbitration/arbitration.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ArbitrationService } from './arbitration/arbitration.service';

@Module({
    imports: [
        ArbitrationModule,
        ConfigModule.forRoot(),
        ScheduleModule.forRoot(),
    ],
    controllers: [AppController],
    providers: [AppService, ArbitrationService],
})
export class AppModule {
}
