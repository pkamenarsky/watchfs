#!/usr/bin/env node

var watchr = require('watchr')
var yaml = require('js-yaml');
var fs = require('fs')
var exec = require('child_process').exec;
var path = require('path');
var program = require('commander');

Array.prototype.filterOn = function (field, value) {
	return this.filter(function(elem) {return elem[field] == value});
}

String.prototype.replaceAll = function (what, str) {
	return this.replace(new RegExp(what, 'g'), str);
}

// ---

program
	.version('0.0.1')
	.option('-o, --outdir <dir>', 'Output directory [out]', String, 'out')
	.option('-w, --watchdir <dir>', 'Watch directory [.]', String, '.')
	.option('-c, --cfg <file>', 'Configuration file [watchrules.yaml]', String, 'watchrules.yaml')
	.parse(process.argv);

if (!fs.existsSync(program.outdir))
	fs.mkdirSync(program.outdir);

rules = yaml.load(fs.readFileSync(program.cfg, 'utf8'));

function outdir(file) {
	return program.outdir + path.sep + path.relative(program.watchdir, path.dirname(file));
}

function substituteVars(str, file) {
	return str
		.replaceAll('\\$file', file)
		.replaceAll('\\$basename', path.basename(file, path.extname(file)))
		.replaceAll('\\$ext', path.extname(file).substr(1))
		.replaceAll('\\$indir', path.dirname(file))
		.replaceAll('\\$outdir', outdir(file));
}

function runExec(array, file) {
	for (var i = 0; i < array.length; i++) {
		if (file.match(array[i].filter) != null) {

			// show message
			console.log(substituteVars(array[i].message, file));

			// create outdir if it doesn't exist
			if (!fs.existsSync(outdir(file)))
				fs.mkdirSync(outdir(file));

			// exec command
			exec(substituteVars(array[i].exec, file), function(error, stdout, stderr) {
				if (error)
					console.log(stderr);
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

// watch fs
watchr.watch({
    path: program.watchdir,
    listener: function(changeType, filePath, fileCurrentStat, filePreviousStat) {
		var handled = false;

		// handle 'createupdate' special case
		if (changeType === 'create' || changeType === 'update')
			handled = handleEvent('createupdate', filePath, fileCurrentStat, filePreviousStat);

		// if 'createupdate' didn't catch anything, handle normal events
		if (!handled)
			handleEvent(changeType, filePath, fileCurrentStat, filePreviousStat);
	}
});
