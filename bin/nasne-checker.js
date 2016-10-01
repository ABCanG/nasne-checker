#!/usr/bin/env node

const program = require('commander');
const slackInitializer = require('slack-notify');
const moment = require('moment');
const {CronJob} = require('cron');
const Nasne = require('../lib/nasne');
const {version} = require('../package.json');


program.on('--help', () => {
  console.log('  Examples:');
  console.log('');
  console.log('    $ nasne-checker \\');
  console.log('      --nasne 192.168.10.10 \\');
  console.log('      --slack https://hooks.slack.com/services/XXX/XXX/XXXXX \\');
  console.log('      --cron "00 20 * * 1,3,5"');
});

program
  .version(version)
  .option('--nasne <host>', 'Nasne host (required)')
  .option('--slack <url>', 'Slack webhook url (required)')
  .option('--cron <format>', 'Cron format (optional)')
  .option('--timezone <timezone>', 'When using cron option (Default is "Asia/Tokyo")')
  .parse(process.argv);


if (!program.nasne || !program.slack) {
  console.log('"--nasne" option and "--slack" option are required.');
  program.outputHelp();
  process.exit(-1);
}

const nasne = new Nasne(program.nasne);
const slack = slackInitializer(program.slack);

function convertEnclose(text) {
  const enclose = [
    ['\ue0fd', '[手]'],
    ['\ue0fe', '[字]'],
    ['\ue0ff', '[双]'],
    ['\ue180', '[デ]'],
    ['\ue182', '[二]'],
    ['\ue183', '[多]'],
    ['\ue184', '[解]'],
    ['\ue185', '[SS]'],
    ['\ue18c', '[映]'],
    ['\ue18d', '[無]'],
    ['\ue190', '[前]'],
    ['\ue191', '[後]'],
    ['\ue192', '[再]'],
    ['\ue193', '[新]'],
    ['\ue194', '[初]'],
    ['\ue195', '[終]'],
    ['\ue196', '[生]'],
    ['\ue19c', '[他]'],
  ];

  return enclose.reduce((converted, [before, after]) => {
    return converted.replace(before, after);
  }, text);
}

function convertField(item) {
  const startTime = moment(item.startDateTime).format('YYYY/MM/DD(ddd) HH:mm');
  const endTime = moment(item.startDateTime).add(item.duration, 's').format('HH:mm');
  return {
    title: convertEnclose(item.title),
    value: `${startTime} - ${endTime}`,
    short: false
  };
}

function postWarning(text, attachment = null) {
  slack.request({
    text,
    attachments: [attachment]
  });
}

function execute() {
  nasne.getHddDetail().then((data) => {
    for (const hdd of data) {
      const parcent = Math.round((hdd.usedVolumeSize / hdd.totalVolumeSize) * 100);
      if (parcent > 90) {
        const type = hdd.internalFlag ? 'External' : 'Internal';
        postWarning(`:floppy_disk: The capacity of the ${type} HDD is insufficient (${parcent}% used).`);
      }
    }
  }, (err) => {
    console.log(err);
    console.error('Failed to get information.');
  });

  nasne.getReservedList().then((data) => {
    const itemList = data.item.sort((a, b) => (
      moment(a.startDateTime) - moment(b.startDateTime))
    );

    const overlapErrorFields = itemList.filter((item) => item.conflictId > 0).map(convertField);
    if (overlapErrorFields.length) {
      postWarning(':warning: Reservations are overlap.', {
        color: 'warning',
        fields: overlapErrorFields
      });
    }

    const notExistErrorFields = itemList.filter((item) => item.eventId === 65536).map(convertField);
    if (notExistErrorFields.length) {
      postWarning(':exclamation: Reservations does not exist.', {
        color: 'danger',
        fields: notExistErrorFields
      });
    }
  }, (err) => {
    console.log(err);
    console.error('Failed to get information.');
  });
}

execute();
if (program.cron) {
  const job = new CronJob({
    cronTime: program.cron,
    onTick: execute,
    start: true,
    timeZone: program.timezone || 'Asia/Tokyo'
  });
}
