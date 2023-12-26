import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from "dotenv";
import { join } from "path";
dotenv.config({ path: join(__dirname, "../.env") });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // app.setGlobalPrefix('api');
  await app.listen(3000);
  console.log(`Execute the following command to modify the configuration: 
  curl --location 'http://localhost:3000/config' \\
    --header 'Content-Type: application/json' \\
    --data '{
        "privateKey": "",
        "secretKey": "Arbitrary string for encrypting the private key",
        "rpc": "https://ethereum-sepolia.publicnode.com",
        "debug": "1",
        "makerApiEndpoint": "https://openapi.orbiter.finance/maker-openapi",
        "gasLimit": "",
        "maxFeePerGas": "",
        "maxPriorityFeePerGas": ""
    }'`);
}
bootstrap();
