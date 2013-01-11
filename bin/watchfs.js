#!/usr/bin/env node

var watchr = require('watchr')
var yaml = require('js-yaml');
var fs = require('fs')
var exec = require('child_process').exec;
var path = require('path');
var program = require('commander');
var wrench = require('wrench');

Array.prototype.filterOn = function (field, value) {
	return this.filter(function(elem) {return elem[field] == value});
}

String.prototype.replaceAll = function (what, str) {
	return this.replace(new RegExp(what, 'g'), str);
}

// ---

// task queue
var tasks = [];
var varName = null;
var varValue = null;

program
	.version('1.1.7')
	.option('-o, --outdir <dir>', 'Output directory [out]', String, 'out')
	.option('-w, --watchdir <dir>', 'Watch directory [.]', String, '.')
	.option('-c, --cfg <file>', 'Configuration file [watchrules.yaml]', String, 'watchrules.yaml')
	.option('-e, --execrules', 'Execute all rules on start', Boolean, false)
	.option('-r, --removeoutdir', 'Recursively remove out directory', Boolean, false);

program.command('set <variable> <value>')
		.description('Set custom variable')
		.action(function(variable, value) {
			varName = variable;
			varValue = value;
		});

program.parse(process.argv);

if (!fs.existsSync(program.outdir))
	wrench.mkdirSyncRecursive(program.outdir);

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
		.replaceAll('\\$outdir', outdir(file))
		.replaceAll('\\$' + varName, varValue);
}

function runExec(command, file) {
	// exec command
	tasks.push(function(callback) {
		// show message
		console.log(substituteVars(command.message, file));

		// create outdir if it doesn't exist
		if (!fs.existsSync(outdir(file)))
			wrench.mkdirSyncRecursive(outdir(file));

		// exec command
		exec(substituteVars(command.exec, file), function(error, stdout, stderr) {
			if (error)
				console.error(stderr);

			// yield back to task queue
			callback();
		});
	});
}

function matchRules(array, file) {
	for (var i = 0; i < array.length; i++) {
		if (file.match(array[i].filter) != null) {
			runExec(array[i], file);

			// break after first matching rule
			return true;
		}
	}

	// no matching rule found
	return false;
}

function handleEvent(changeType, filePath, fileCurrentStat, filePreviousStat) {
	var stat = fileCurrentStat ? fileCurrentStat : filePreviousStat;

	if (stat.mode & 0x4000 != 0)
		return matchRules(rules.filterOn('type', 'dir').filterOn('event', changeType), filePath);
	else
		return matchRules(rules.filterOn('type', 'file').filterOn('event', changeType), filePath);
}

function handleFile(changeType, filePath, fileCurrentStat, filePreviousStat) {
	var handled = false;

	// handle 'createupdate' special case
	if (changeType === 'create' || changeType === 'update')
		handled = handleEvent('createupdate', filePath, fileCurrentStat, filePreviousStat);

	// if 'createupdate' didn't catch anything, handle normal events
	if (!handled)
		handleEvent(changeType, filePath, fileCurrentStat, filePreviousStat);
}

function watchfs() {
	tasks.push(function(callback) {
		console.log('Watching ' + program.watchdir + '...');
		callback();
	});

	watchr.watch({
		path: program.watchdir,
		listener: function(changeType, filePath, fileCurrentStat, filePreviousStat) {
			handleFile(changeType, filePath, fileCurrentStat, filePreviousStat);
			drainQueue();
		}
	});
}

// main
if (program.removeoutdir)
	wrench.rmdirSyncRecursive(program.outdir, true);

if (program.execrules) {
	var files = wrench.readdirSyncRecursive(program.watchdir);
	var initRule = rules.filterOn('type', 'init');

	for (var i = 0; i < files.length; i++)
		handleFile('create', path.join(program.watchdir, files[i]),
				   fs.statSync(path.join(program.watchdir, files[i])), null);

	if (initRule.length >= 1)
		runExec(initRule[0], '');

	tasks.push(function(callback) {
		console.log('');
		callback();
	});
}


watchfs();

// queue
function drainQueue() {
	if (tasks.length > 0)
		tasks.shift()(drainQueue);
}

// run task queue
drainQueue();
