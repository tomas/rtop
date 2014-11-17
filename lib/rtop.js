var Canvas  = require('drawille'),
    blessed = require('blessed'),
    Remote  = require('./remote'),
    VERSION = require('../package.json').version;

var stats = ['cpu', 'mem'];

var loadedTheme = {
  title: { fg: '#767150' },
  chart:
   { fg: '#66D9EF',
     border: { type: 'line', fg: '#ccc' } },
  table:
   { fg: 'fg',
     items: { selected: { bg: "#F92672", fg: 'fg' }, item: { fg: 'fg' } },
     border: { type: 'line', fg: '#ccc' } },
  footer: { fg: 'fg' }
}

var Rtop = function() {

  var screen,
      program,
      logger,
      hosts,
      boxes     = {},
      charts    = {},
      remotes   = {};

  var graph_scale = 1;

  var size = {
    pixel: {
      width  : 0,
      height : 0
    },
    character: {
      width  : 0,
      height : 0
    }
  };

  // Private functions

  /**
   * Draw header
   * @param  {string} left  This is the text to go on the left
   * @param  {string} right This is the text for the right
   * @return {void}
   */
  var drawHeader = function() {
    var headerText = ' {bold}rtop{/bold} ';
    var headerTextNoTags = ' rtop ';

    var header = blessed.text({
      top     : 'top',
      left    : 'left',
      width   : headerTextNoTags.length,
      height  : '1',
      fg      : loadedTheme.title.fg,
      content : headerText,
      tags    : true
    });

    logger = blessed.text({
      top     : 'top',
      left    : '40%',
      width   : 20,
      height  : '1',
      align   : 'left',
      content : '',
      tags    : true
    });

    var date = blessed.text({
      top     : 'top',
      right   : 0,
      width   : 8,
      height  : '1',
      align   : 'right',
      content : '',
      tags    : true
    });

    screen.append(header);
    screen.append(logger);
    screen.append(date);

    var zeroPad = function(input) {
      return ('0' + input).slice(-2);
    };

    var updateTime = function() {
      var time = new Date();
      date.setContent(zeroPad(time.getHours()) + ':' + zeroPad(time.getMinutes()) + ':' + zeroPad(time.getSeconds()) + ' ');
      screen.render();
    };

    updateTime();
    setInterval(updateTime, 1000);
  };

  /**
   * Repeats a string
   * @var string The string to repeat
   * @var integer The number of times to repeat
   * @return {string} The repeated chars as a string.
   */
  var stringRepeat = function(string, num) {
    if (!num || num < 0)
      return '';

    return new Array(num + 1).join(string);
  };

  var showMessage = function(message) {
    logger.setContent(message);
  }

  var setHostMessage = function(host, message) {
    for (var stat in boxes[host]) {
      boxes[host][stat].setContent(message);
    }
  }

  /**
   * This draws a chart
   * @param  {int} chartKey The key of the chart.
   * @return {string}       The text output to draw.
   */
  var drawChart = function(chart) {
    var c = chart.chart;
    c.clear();

    var dataPointsToKeep = 5000,
        current_value    = chart.remote[chart.stat]();

    if (current_value === null) {
      if (chart.values.length > 0)
        return 'Disconnected!';
      else
        return 'Waiting for data...';
    }

    var position = ++chart.position;
    chart.values[position] = current_value;

    var computeValue = function(input) {
      return chart.height - Math.floor(((chart.height + 1) / 100) * input) - 1;
    };

    if (position > dataPointsToKeep) {
      delete chart.values[position - dataPointsToKeep];
    }

    for (var pos in chart.values) {

      if (graph_scale >= 1 || (graph_scale < 1 && pos % (1 / graph_scale) == 0)) {
        var p = parseInt(pos, 10) + (chart.width - chart.values.length);
        // calculated x-value based on graph_scale
        var x = (p * graph_scale) + ((1 - graph_scale) * chart.width);

        // draws top line of chart
        if (p > 1 && computeValue(chart.values[pos - 1]) > 0) {
          c.set(x, computeValue(chart.values[pos - 1]));
        }

        // Start deleting old data points to improve performance
        // @todo: This is not be the best place to do this

        // fills all area underneath top line
        for (var y = computeValue(chart.values[pos - 1]); y < chart.height; y ++) {
          if (graph_scale > 1 && p > 0 && y > 0) {
            var current = computeValue(chart.values[pos - 1]),
              next = computeValue(chart.values[pos]),
              diff = (next - current) / graph_scale;

            // adds columns between data if graph is zoomed in, takes average where data is missing to make smooth curve
            for (var i = 0; i < graph_scale; i++) {
              c.set(x + i, y + (diff * i));
              for (var j = y + (diff * i); j < chart.height; j++) {
                c.set(x + i, j);
              }
            }
          } else if (graph_scale <= 1) {
            // magic number used to calculate when to draw a value onto the chart
            var allowedPValues = (chart.values.length - ((graph_scale * chart.values.length) + 1)) * -1;
            c.set(x, y);
          }
        }
      }
    }

    // Add percentage to top right of the chart by splicing it into the braille data
    var textOutput = c.frame().split('\n');
    var percent    = ' ' + current_value;

    textOutput[0]  = textOutput[0].slice(0, textOutput[0].length - 4);
    textOutput[0] += '{white-fg}' + parseFloat(percent).toString().slice(0, 4) + '%{/white-fg}';

    return textOutput.join('\n');
  };

  var drawTable = function(container, current_value) {

    var columnLengths = {};

    // Clone the column array
    var columns  = ['process', 'cpu', 'mem', 'pid'],
        paddings = [5, 5, 5, 5];

    columns.reverse();
    var i = 0;
    var removeColumn = false;
    var lastItem = columns[columns.length - 1];

    var minimumWidth = 7;

    if (container.width < 35) {
      paddings = [0,0,2,2];
    }

    if (container.width < 25) {
      paddings = [0,0,1,1];
    }

    // Keep trying to reduce the number of columns
    do {
      var totalUsed = 0;
      var firstLength = 0;
      var totalColumns = columns.length;

      // Allocate space for each column in reverse order
      for (var column in columns) {
        var item = columns[column];
        i++;

        // If on the last column (actually first because of array order)
        // then use up all the available space

        if (item == lastItem) {
          columnLengths[item] = container.width - totalUsed;
          firstLength = columnLengths[item];
        } else {
          columnLengths[item] = item.length + paddings[i];
        }

        totalUsed += columnLengths[item];
      }

      if (firstLength < minimumWidth && columns.length > 1) {
        totalUsed = 0;
        columns.shift();
        removeColumn = true;
      } else {
        removeColumn = false;
      }

    } while (removeColumn);

    // And back again
    columns.reverse();

    var titleOutput = '{bold}';
    var titleOutput = '';

    for (var headerColumn in columns) {
      var colText = ' ' + columns[headerColumn];
      titleOutput += (colText + stringRepeat(' ', columnLengths[columns[headerColumn]] - colText.length));
    }

    titleOutput += '{/bold}' + "\n";
    // console.log(titleOutput);

    var bodyOutput = [];

    for (var row in current_value) {
      var currentRow = current_value[row];
      var rowText = '';

      for (var bodyColumn in columns) {
        var colText = '' + currentRow[columns[bodyColumn]];

        rowText += (colText + stringRepeat(' ', columnLengths[columns[bodyColumn]] - colText.length)).slice(0, columnLengths[columns[bodyColumn]]);
      }

      bodyOutput.push(rowText);
    }

    return {
      title: titleOutput,
      body: bodyOutput,
      processWidth: columnLengths[columns[0]]
    };

  }

  var drawProcessList = function(host) {
    var remote = remotes[host],
        box    = boxes[host].processes_box,
        list   = boxes[host].processes_list;

    var currentItems = remote.current_processes || [];
    var table = drawTable(list, remote.processes());

    box.setContent(table.title);

    // If we keep the stat numbers the same immediately, then update them
    // after, the focus will follow. This is a hack.
    var existingStats = {};
    // Slice the start process off, then store the full stat,
    // so we can inject the same stat onto the new order for a brief render
    // cycle.
    for (var stat in currentItems) {
      var thisStat = currentItems[stat];
      existingStats[thisStat.slice(0, table.processWidth)] = thisStat;
    }

    processWidth = table.processWidth;
    // Smush on to new stats
    var tempStats = [];
    for (var stat in table.body) {
      var thisStat = table.body[stat];
      tempStats.push(existingStats[thisStat.slice(0, table.processWidth)]);
    }

    // Move cursor position with temp stats
    list.setItems(tempStats);

    // Update the numbers
    list.setItems(table.body);
    // list.focus();

    remote.current_processes = table.body;
  }


  /**
   * Overall draw function, this should poll and draw results of
   * the loaded sensors.
   */
  var drawAllStats = function() {
    Object.keys(remotes).forEach(drawHost);
    screen.render();
  };

  var drawHostStats = function(host) {
    if (remotes[host].connected) {
      drawProcessList(host);

      stats.forEach(function(stat) {
        boxes[host][stat].setContent(drawChart(charts[host][stat]));
      })
    }
  }

  var drawBoxes = function() {
    hosts.forEach(drawHostBoxes);
  }

  var drawHostBoxes = function(host, index) {

    var content    = ' Waiting for data...',
        box_height = '33%'; // 3 per host

    if (!boxes[host]) {
      boxes[host] = {};
      content = ' Connecting...';
    }

    if (boxes[host].cpu)
      screen.remove(boxes[host].cpu);
    if (boxes[host].mem)
      screen.remove(boxes[host].mem);
    if (boxes[host].processes_box)
      screen.remove(boxes[host].processes_box);

    var width   = (100 / hosts.length),
        padding = index * width;

    boxes[host].cpu = blessed.box({
      top     : 1,
      left    : padding + '%',
      width   : width + '%',
      height  : box_height,
      content : content,
      label   : ' ' + host + ' cpu',
      tags    : true,
      fg      : loadedTheme.chart.fg,
      border  : loadedTheme.chart.border
    });

    screen.append(boxes[host].cpu);

    boxes[host].mem = blessed.box({
      top     : boxes[host].cpu.height + 1,
      left    : padding + '%',
      width   : width + '%',
      height  : boxes[host].cpu.height,
      content : content,
      label   : ' ' + host + ' mem',
      tags    : true,
      fg      : loadedTheme.chart.fg,
      border  : loadedTheme.chart.border
    });

    screen.append(boxes[host].mem);

    boxes[host].processes_box = blessed.box({
      top     : (boxes[host].cpu.height * 2) + 1,
      height  : boxes[host].cpu.height,
      left    : padding + '%',
      width   : width + '%',
      label   : ' ' + host + ' load',
      keys    : true,
      mouse   : true,
      tags    : true,
      fg      : loadedTheme.table.fg,
      border  : loadedTheme.table.border
    });

    screen.append(boxes[host].processes_box);

    boxes[host].processes_list = blessed.list({
      height  : boxes[host].processes_box.height - 3,
      top     : 2,
      width   : boxes[host].processes_box.width - 2,
      left    : 1,
      keys    : true,
      mouse   : true,
      vi      : true,
      content : content,
      style   : loadedTheme.table.items
    });

    boxes[host].processes_box.append(boxes[host].processes_list);
  };

  var setupCharts = function() {
    hosts.forEach(setupHostCharts);
  }

  var setupHostCharts = function(host) {

    var cpu_box = boxes[host].cpu;
    size.pixel.width  = (cpu_box.width - 2) * 2;
    size.pixel.height = (cpu_box.height - 2) * 4;

    stats.forEach(function(stat) {

      var box    = boxes[host][stat],
          width  = (box.width - 3) * 2,
          height = ((box.height - 2) * 4),
          canvas = new Canvas(width, height);

      if (!charts[host])
        charts[host] = {};

      // If we're reconfiguring a plugin, then preserve the already recorded values
      var values = charts[host][stat] ? charts[host][stat].values : [];

      var chart = {
        position : 0,
        stat   : stat,
        host   : host,
        chart  : canvas,
        values : values,
        remote : remotes[host],
        width  : width,
        height : height
      };

      charts[host][stat] = chart;
    });

  };

  var exit = function() {
    var count = Object.keys(remotes),
        done  = function(err) { --count || process.exit() };

    for (var host in remotes) {
      remotes[host].stop(done);
    }
  }

  return {

    init: function(host_list, opts) {
      if (!host_list.length || host_list.length == 0)
        throw new Error('Invalid host list: ' + host_list);

      hosts   = host_list;
      screen  = blessed.screen();
      program = blessed.program();

      screen.on('keypress', function(ch, key) {
        if (key.name == 'q')
          exit()
      });

      process.on('SIGINT', exit);

      drawHeader();

      hosts.forEach(function(host) {
        var remote = new Remote(host, opts);

        remote.start(function(err) {
          if (err) setHostMessage(err.message);
          // setHostMessage(host, err ? err.message : 'Connected!');

          if (err) return;

          remote.on('update', function() {
            drawHostStats(host);
          });
        });

        remotes[host] = remote;
      })

      drawBoxes();
      screen.on('resize', drawBoxes);

      setupCharts();
      screen.on('resize', setupCharts);
    }
  };

}();

exports.start = Rtop.init;
