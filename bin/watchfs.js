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

program
	.version('1.1.3')
	.option('-o, --outdir <dir>', 'Output directory [out]', String, 'out')
	.option('-w, --watchdir <dir>', 'Watch directory [.]', String, '.')
	.option('-c, --cfg <file>', 'Configuration file [watchrules.yaml]', String, 'watchrules.yaml')
	.option('-e, --execrules', 'Execute all rules on start', Boolean, false)
	.option('-r, --removeoutdir', 'Recursively remove out directory', Boolean, false)
	.parse(process.argv);

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
		.replaceAll('\\$outdir', outdir(file));
}

function runExec(array, file) {
	for (var i = 0; i < array.length; i++) {
		if (file.match(array[i].filter) != null) {

			// exec command
			tasks.push(function(callback) {
				// show message
				console.log(substituteVars(array[i].message, file));

				// create outdir if it doesn't exist
				if (!fs.existsSync(outdir(file)))
					wrench.mkdirSyncRecursive(outdir(file));

				// exec command
				exec(substituteVars(array[i].exec, file), function(error, stdout, stderr) {
					if (error)
						console.error(stderr);

					// yield back to task queue
					callback();
				});
			});

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
		return runExec(rules.filterOn('type', 'dir').filterOn('event', changeType), filePath);
	else
		return runExec(rules.filterOn('type', 'file').filterOn('event', changeType), filePath);
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
		}
	});
}

// main
if (program.removeoutdir)
	wrench.rmdirSyncRecursive(program.outdir, true);

if (program.execrules) {
	var files = wrench.readdirSyncRecursive(program.watchdir);

	for (var i = 0; i < files.length; i++)
		handleFile('create', path.join(program.watchdir, files[i]),
				   fs.statSync(path.join(program.watchdir, files[i])), null);

	tasks.push(function(callback) {
		console.log('');
		callback();
	});
}

watchfs();

// queue
function drainQueue() {
	if (tasks.length > 0) {
		tasks.shift()(drainQueue);
	}
	else
		process.nextTick(drainQueue);
}

// run task queue
drainQueue();
