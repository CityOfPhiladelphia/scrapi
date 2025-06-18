import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import path from 'node:path';
import fs from 'node:fs';
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { exec } from "aws-cdk";



export class ScrapiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        
        // Build code
        
        execFileSync('npm', ['run', 'build:code'], { cwd: '../src', shell: true, stdio: 'inherit' });
        execFileSync('npm', ['run', 'build:install'], { cwd: '../src', shell: true, stdio: 'inherit' });
        execFileSync('npm', ['run', 'build:zip'], { cwd: '../src', shell: true, stdio: 'inherit' });
        const chromeLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ChromeLayer", "arn:aws:lambda:us-east-1:764866452798:layer:chrome-aws-lambda:50");
        
        const proxyLambda = new nodejs.NodejsFunction(this, "proxy", {
            code: lambda.Code.fromAsset('../src/dist/scrapi.zip'),
            // code: lambda.Code.fromAsset(path.resolve(__dirname, "../../src")),
            handler: "index.main",
            runtime: lambda.Runtime.NODEJS_22_X,
            // Required for Chromium to run in Lambda
            architecture: lambda.Architecture.X86_64,
            memorySize: 2048,
            timeout: cdk.Duration.minutes(3),
            layers: [
                chromeLayer
            ],
            
        });

        // Define the API Gateway
        const api = new apigateway.RestApi(this, "ScrapiApi", {
            restApiName: "Scrapi Service",
            description: "API Gateway with Lambda proxy integration."
        });

        // Add API Key
        const apiKey = api.addApiKey("ApiKey");
        const plan = api.addUsagePlan("UsagePlan", {
            name: "Basic"
        });
        plan.addApiKey(apiKey);
        plan.addApiStage({ stage: api.deploymentStage });

        // Integrate API Gateway with Lambda
        const lambdaIntegration = new apigateway.LambdaIntegration(proxyLambda);
        api.root.addMethod("ANY", lambdaIntegration, {
            apiKeyRequired: true
        });

        // Output the API URL
        new cdk.CfnOutput(this, "ApiUrl", {
            value: api.url,
            description: "The URL of the API Gateway endpoint"
        });

        new cdk.CfnOutput(this, "APIKey", {
            value: apiKey.keyId,
            description: "The API Key for accessing the API Gateway"
        });
    };
};
