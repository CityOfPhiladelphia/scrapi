#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ScrapiStack } from "../lib/scrapi-stack";


const app = new cdk.App();

// Build Container

new ScrapiStack(app, "ScrapiStack");

