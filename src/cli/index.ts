#!/usr/bin/env node
import { Command } from 'commander'
import { registerStartCommand } from './start-command.js'

const program = new Command()
program.name('co2').description('OpenAI and Claude protocol conversion gateway')
registerStartCommand(program)
await program.parseAsync(process.argv)
