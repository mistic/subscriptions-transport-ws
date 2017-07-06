#!/usr/bin/env node
'use strict';

var execSync = require('child_process').execSync;
var stat = require('fs').stat;

function exec(command) {
    execSync(command, {
        stdio: [0, 1, 2]
    });
}

stat('dist', function(error, stat) {
    console.log(process.env);
    if (error || !stat.isDirectory()) {
        exec('npm install --only=dev && npm run compile && npm run browser-compile && rimtsf src');
    }
});
