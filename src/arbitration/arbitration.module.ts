import { Module } from '@nestjs/common';
import { ArbitrationJobService } from './arbitrationJob.service';
import { ArbitrationService } from './arbitration.service';

@Module({
    controllers: [],
    providers: [ArbitrationJobService, ArbitrationService],
    exports: [],
    imports: [],
})
export class ArbitrationModule {
}
