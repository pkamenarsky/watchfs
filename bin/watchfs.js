#!/usr/bin/env node

var watchr = require('watchr')
var yaml = require('js-yaml');
var fs = require('fs')
var exec = require('child_process').exec;
var path = require('path');
var program = require('commander');
var wrench = require('wrench');
var asyncblock = require('asyncblock');

Array.prototype.filterOn = function (field, value) {
	return this.filter(function(elem) {return elem[field] == value});
}

String.prototype.replaceAll = function (what, str) {
	return this.replace(new RegExp(what, 'g'), str);
}

// ---

program
	.version('1.1.0')
	.option('-o, --outdir <dir>', 'Output directory [out]', String, 'out')
	.option('-w, --watchdir <dir>', 'Watch directory [.]', String, '.')
	.option('-c, --cfg <file>', 'Configuration file [watchrules.yaml]', String, 'watchrules.yaml')
	.option('-e, --execrules', 'Execute all rules on start', Boolean, false)
	.parse(process.argv);

if (!fs.existsSync(program.outdir))
	fs.mkdirSync(program.outdir);

rules = yaml.load(fs.readFileSync(program.cfg, 'utf8'));

function outdir(file) {
	return path.join(program.outdir, path.relative(program.watchdir, path.dirname(file)));
}

function substituteVars(str, file) {
	return str
		.replaceAll('\\$file', file)
		.replaceAll('\\$basename', path.basename(file, path.extname(file)))
		.replaceAll('\\$ext', path.extname(file))
		.replaceAll('\\$indir', path.dirname(file))
		.replaceAll('\\$outdir', outdir(file));
}

function runExec(flow, array, file) {
	for (var i = 0; i < array.length; i++) {
		if (file.match(array[i].filter) != null) {

			// show message
			console.log(substituteVars(array[i].message, file));

			// create outdir if it doesn't exist
			if (!fs.existsSync(outdir(file)))
				fs.mkdirSync(outdir(file));

			// exec command
			exec(substituteVars(array[i].exec, file), flow);
			var result = flow.wait();

			if (result.error)
				console.error(result.stderr);

			// break after first matching rule
			return true;
		}
	}

	// no matching rule found
	return false;
}

function handleEvent(flow, changeType, filePath, fileCurrentStat, filePreviousStat) {
	var stat = fileCurrentStat ? fileCurrentStat : filePreviousStat;

	if (stat.mode & 0x4000 != 0)
		return runExec(flow, rules.filterOn('type', 'dir').filterOn('event', changeType), filePath);
	else
		return runExec(flow, rules.filterOn('type', 'file').filterOn('event', changeType), filePath);
}

function handleFile(flow, changeType, filePath, fileCurrentStat, filePreviousStat) {
	var handled = false;

	// handle 'createupdate' special case
	if (changeType === 'create' || changeType === 'update')
		handled = handleEvent(flow, 'createupdate', filePath, fileCurrentStat, filePreviousStat);

	// if 'createupdate' didn't catch anything, handle normal events
	if (!handled)
		handleEvent(flow, changeType, filePath, fileCurrentStat, filePreviousStat);
}

function watchfs() {
	console.log('Watching ' + program.watchdir + '...');

	asyncblock(function(flow) {
		watchr.watch({
			path: program.watchdir,
			listener: function(changeType, filePath, fileCurrentStat, filePreviousStat) {
				handleFile(flow, changeType, filePath, fileCurrentStat, filePreviousStat);
			}
		});
	});
}

// main
if (program.execrules) {
	var files = wrench.readdirSyncRecursive(program.watchdir);

	asyncblock(function(flow) {
		for (var i = 0; i < files.length; i++)
			handleFile(flow, 'create', path.join(program.watchdir, files[i]),
					   fs.statSync(path.join(program.watchdir, files[i])), null);
	});
}

watchfs();
