rtop
====

A light version of top for monitoring multiple servers in parallel.

Forked and heavily based on the cool [vtop](https://github.com/MrRio/vtop) project.

![](https://raw.githubusercontent.com/tomas/rtop/master/screenshot.png)

## Running

    rtop a.domain.com b.domain.com
    
## Options

    -u [user]
    -p [port]
    -k [path/to/private.key]

For example, to log in using a specific user and port:

    rtop -u user -p 24 host1 host2 host3

You can also pass hosts in the regular user@host:port notation:

    rtop user@host1:21 deploy@host2:23 host3

You can use the two things together, of course. If a local user or port is present, it will override the globally defined one.

    rtop -p 222 host1 host2:333 host3

In this case, rtop will connect hosts 1 and 3 via port 222, and use 333 for the second one.

## Using rtop programatically

The API is `rtop.start(hosts, options)`.

``` js
var rtop  = require('rtop');
   
var hosts = [ 'host1', 'someone@host2.com', 'host3.server.com:2222' ],
    opts  = { key_path: '/some/where/id_rsa' };

rtop.start(hosts, opts);
```

The same global vs local options apply as described above.

## Install

    npm install -g rtop

## Who

(Over)written by Tomás Pollak, being the original code by James Hall.

## Contributing

Of course. Fork, commit, create a pull request, you know. Feature additions are most welcome.

## Copyright

(c) 2014 Fork, Ltd. MIT Licensed.
