var watchr = require('watchr')
var yaml = require('yaml')
var fs = require('fs')
var exec = require('child_process').exec;
var path = require('path');

Array.prototype.filterOn = function (field, value) {
	return this.filter(function(elem) {return elem[field] == value});
}

// ---

rules = yaml.eval(fs.readFileSync('watchrules.yaml', 'utf8'));

function runExec(array, file) {
	for (var i = 0; i < array.length; i++) {
		var ext = path.extname(file);
		var out = path.dirname(file) + path.sep + path.basename(file, ext);

		if (array[i].filter == ext.substr(1)) {
			console.log(array[i].message.replace("$file", file).replace("$out", out));

			exec(array[i].exec.replace("$file", file).replace("$out", out), function(error, stdout, stderr) {
				if (error != 0)
					console.log(stderr);
			});
		}
	}
}

watchr.watch({
    path: '.',
    listener: function(changeType, filePath, fileCurrentStat, filePreviousStat) {
		var stat = fileCurrentStat ? fileCurrentStat : filePreviousStat;

		if (stat.mode & 0x4000 != 0)
			runExec(rules.filterOn('type', 'dir').filterOn('event', changeType), filePath);
		else
			runExec(rules.filterOn('type', 'file').filterOn('event', changeType), filePath);

		// console.log(filePath + ' - ' + changeType);
	}
});
