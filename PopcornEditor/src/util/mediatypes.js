/* This Source Code Form is subject to the terms of the MIT license
 * If a copy of the MIT license was not distributed with this file, you can
 * obtain one at https://raw.github.com/mozilla/butter/master/LICENSE */

define( [ "util/uri", "util/xhr", "json!../../api/butterconfig", "jquery" ],
  function( URI, xhr, config, $ ) {
  config = JSON.parse(config);

  var REGEX_MAP = {
        YouTube: /^(?:https?:\/\/www\.|https?:\/\/|www\.|\.|^)youtu/,
        Vimeo: /^https?:\/\/(www\.)?(player\.)?vimeo\.com\/(\w+\/)*(\d+)/,
        SoundCloud: /^(?:https?:\/\/www\.|https?:\/\/|www\.|\.|^)(w\.)?(soundcloud)/,
        Archive: /^(?:https?:\/\/www\.|https?:\/\/|www\.|\.|^)archive\.org\/(details|download|stream)\/((.*)start(\/|=)[\d\.]+(.*)end(\/|=)[\d\.]+)?/,
        // supports #t=<start>,<duration>
        // where start or duration can be: X, X.X or XX:XX
        "null": /^\s*#t=(?:\d*(?:(?:\.|\:)?\d+)?),?(\d+(?:(?:\.|\:)\d+)?)\s*$/,
        Flickr: /^https?:\/\/(www\.)?flickr\.com/,
        Clyp: /^https?:\/\/(www\.)?(staging\.)?(?:clyp\.it|audiour\.com)/,
        AirMozilla: /^https?:\/\/(?:www\.)?(?:air\.mozilla\.org|localhost:8000)\/(.+)\//,
        Wikimedia: /^https?:\/\/commons.wikimedia.org\/wiki\/(File(?::|%3A).*)/,
  },
      VIMEO_EMBED_UNPLAYABLE = "This Vimeo video is unplayable",
      YOUTUBE_EMBED_DISABLED = "Embedding of this YouTube video is disabled",
      YOUTUBE_EMBED_UNPLAYABLE = "This YouTube video is unplayable",
      YOUTUBE_EMBED_PRIVATE = "Private Video",
      ARCHIVE_EMBED_DISABLED = "Embedding of this Archive item is not available yet",
      EMBED_UNPLAYABLE = "This media source is unplayable",
      CLYP_EMBED_UNPLAYABLE = "This Clyp source is unplayable",
      SOUNDCLOUD_EMBED_UNPLAYABLE = "This SoundCloud source is unplayable",
      SOUNDCLOUD_EMBED_DISABLED = "Embedding of this SoundCloud audio source is disabled",
      WIKIMEDIA_EMBED_UNPLAYABLE = "This Wikimedia Commons video is unplayable";

  var nodeHubbleEndpoint = config.node_hubble_endpoint.replace( /\/$/, "" ),
      clypEndpoint = config.clyp_endpoint.replace( /\/$/, "" );

  function jwPlayerFallback( options, successCallback, errorCallback ) {
    // We hit an error trying to load HTML5, try the jwplayer instead
    var media,
        div = document.createElement( "div" ),
        container = document.createElement( "div" );

    div.style.height = "400px";
    div.style.width = "400px";
    div.style.left = "-400px";
    div.style.position = "absolute";
    container.style.height = "100%";
    container.style.width = "100%";

    document.body.appendChild( div );
    div.appendChild( container );

    function errorEvent() {
      media.removeEventListener( "loadedmetadata", readyEvent, false );
      media.removeEventListener( "error", errorEvent, false );
      errorCallback( EMBED_UNPLAYABLE );
      document.body.removeChild( div );
    }

    function readyEvent() {
      media.removeEventListener( "loadedmetadata", readyEvent, false );
      media.removeEventListener( "error", errorEvent, false );
      document.body.removeChild( div );
      successCallback({
        source: options.source,
        title: options.title || options.source,
        type: options.type,
        thumbnail: options.thumbnail || "",
        linkback: options.linkback,
        duration: media.duration
      });
    }
    container.id = Popcorn.guid( "popcorn-jwplayer-" );
    media = Popcorn.HTMLJWPlayerVideoElement( container );
    media.addEventListener( "error", errorEvent );
    media.addEventListener( "loadedmetadata", readyEvent );
    media.src = options.source;
  }

  return {
    checkUrl: function( url ) {
      for ( var type in REGEX_MAP ) {
        if ( REGEX_MAP.hasOwnProperty( type ) ) {
          if ( REGEX_MAP[ type ].test( url ) ) {
            return type;
          }
        }
      }
      return "HTML5";
    },
    getMetaData: function( baseUrl, successCallback, errorCallback ) {
      // Ensure that we don't wind up having strings decoded twice.
      baseUrl = decodeURI( baseUrl );

      var id,
          parsedUri,
          splitUriDirectory,
          xhrURL,
          type = this.checkUrl( baseUrl ),
          videoElem;

      successCallback = successCallback || function(){};
      errorCallback = errorCallback || function(){};

      if ( type === "YouTube" ) {
        parsedUri = URI.parse( baseUrl );
        // youtube id can either be a query under v, example:
        // http://www.youtube.com/watch?v=p_7Qi3mprKQ
        // Or at the end of the url like this:
        // http://youtu.be/p_7Qi3mprKQ
        // and:
        // http://www.youtube.com/embed/p_7Qi3mprKQ
        id = parsedUri.queryKey.v || parsedUri.directory.replace( /\/(embed\/)?/, "" );
        if ( !id ) {
          return;
        }

        xhrURL = "https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=" + id + "&key=AIzaSyBAYnjTdheTdR38IPicYk2iGbbxP03ctkQ&alt=json&callback=?";
        Popcorn.getJSONP( xhrURL, function( resp ) {
          var respData = resp.items[0].snippet,
              from = parsedUri.queryKey.t,
              popcorn,
              div = document.createElement( "div" ),
              source;

          div.style.height = "400px";
          div.style.width = "400px";
          div.style.left = "-400px";
          div.style.position = "absolute";

          document.body.appendChild( div );

          if ( resp.error ) {
            if ( resp.error.code === 403 ){
              return errorCallback( YOUTUBE_EMBED_PRIVATE );
            }
            errorCallback( YOUTUBE_EMBED_UNPLAYABLE );
          }

          if ( !respData ) {
            return;
          }

          if ( resp.items[0].status.embeddable !== true ) {
            errorCallback( YOUTUBE_EMBED_DISABLED );
            return;
          }

          function errorEvent() {
            popcorn.off( "loadedmetadata", readyEvent );
            popcorn.off( "error", errorEvent );
            errorCallback( YOUTUBE_EMBED_UNPLAYABLE );
            popcorn.destroy();
          }

          function readyEvent() {
            popcorn.off( "loadedmetadata", readyEvent );
            popcorn.off( "error", errorEvent );
            document.body.removeChild( div );
            popcorn.destroy();

            successCallback({
              source: source,
              title: respData.title,
              type: type,
              thumbnail: respData.thumbnails.default.url,
              author: respData.channelTitle,
              duration: popcorn.duration(),
              from: from
            });
          }

          if ( from ) {
            from = from.replace( /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/, function( all, hours, minutes, seconds ) {
              // Make sure we have real zeros
              hours = hours | 0; // bit-wise OR
              minutes = minutes | 0; // bit-wise OR
              seconds = seconds | 0; // bit-wise OR
              return ( +seconds + ( ( ( hours * 60 ) + minutes ) * 60 ) );
            });
          }

          source = "http://www.youtube.com/watch?v=" + id;
          popcorn = Popcorn.smart( div, source );
          popcorn.on( "error", errorEvent );
          if ( popcorn.media.readyState >= 1 ) {
            readyEvent();
          } else {
            popcorn.on( "loadedmetadata", readyEvent );
          }
        });
      } else if ( type === "SoundCloud" ) {
        parsedUri = URI.parse( baseUrl );

        if ( parsedUri.host === "soundcloud.com" ) {

          xhrURL = "https://api.soundcloud.com/resolve.json?callback=?&client_id=PRaNFlda6Bhf5utPjUsptg&url=" + decodeURIComponent( baseUrl );
        // If an embed iframe source is used, which looks like this:
        // https://w.soundcloud.com/player/?url=https://api.soundcloud.com/tracks/11921587
        } else if ( parsedUri.host === "w.soundcloud.com" ) {
          id = parsedUri.queryKey.url.split( "api.soundcloud.com/tracks/" )[ 1 ];
          xhrURL = "https://api.soundcloud.com/tracks/" + id + ".json?callback=?&client_id=PRaNFlda6Bhf5utPjUsptg";
        }

        Popcorn.getJSONP( xhrURL, function( respData ) {
          if ( !respData ) {
            return;
          }

          if ( respData.error ) {
            return errorCallback( SOUNDCLOUD_EMBED_UNPLAYABLE );
          }

          if ( respData.sharing === "private" || respData.embeddable_by === "none" ) {
            errorCallback( SOUNDCLOUD_EMBED_DISABLED );
            return;
          }
          successCallback({
            source: respData.permalink_url || baseUrl,
            type: type,
            thumbnail: respData.artwork_url || "../../resources/icons/soundcloud-small.png",
            duration: respData.duration / 1000,
            title: respData.title,
            hidden: true
          });
        });
      } else if ( type === "Vimeo" ) {
        parsedUri = URI.parse( baseUrl );
        splitUriDirectory = parsedUri.directory.split( "/" );
        id = splitUriDirectory[ splitUriDirectory.length - 1 ];
        xhrURL = "https://vimeo.com/api/v2/video/" + id + ".json?callback=?";
        Popcorn.getJSONP( xhrURL, function( respData ) {
          var source = "http://vimeo.com/" + id;
          if ( !respData ) {
            return;
          }

          if ( respData.error ) {
            return errorCallback( VIMEO_EMBED_UNPLAYABLE );
          }
          respData = respData && respData[ 0 ];
          successCallback({
            source: source,
            type: type,
            thumbnail: respData.thumbnail_small,
            duration: respData.duration,
            title: respData.title
          });
        });
      } else if ( type === "Archive" ) {
        // We don't accept direct MP4/OGV links to videos since Archive.org doesn't want to directly
        // expose the main video's. Until noted, keep it this way and don't change this.
        // Basically always check that any valid types are not included so we can continue to
        // prevent direct video links being pasted in and attributed as HTML5 video.
        if ( baseUrl.indexOf( "details" ) === -1 && baseUrl.indexOf( "stream" ) === -1 ) {
          return errorCallback( ARCHIVE_EMBED_DISABLED );
        }

        xhrURL = "https://archive.org/services/maker.php?callback=caller&url=" + encodeURIComponent( baseUrl );

        Popcorn.getJSONP( xhrURL, function( respData ) {

          if ( !respData || respData.error || !respData.title || !respData.duration ) {
            return errorCallback( ARCHIVE_EMBED_DISABLED );
          }

          videoElem = document.createElement( "video" );
          videoElem.addEventListener( "error", function() {
            var options = {
              source: respData.media,
              type: type,
              title: respData.title,
              thumbnail: respData.thumb,
              linkback: respData.linkback
            };
            jwPlayerFallback( options, successCallback, errorCallback );
          } );
          videoElem.addEventListener( "loadedmetadata", function() {
            successCallback({
              source: respData.media,
              type: type,
              title: respData.title,
              thumbnail: respData.thumb,
              linkback: respData.linkback,
              duration: videoElem.duration
            });
          } );
          videoElem.src = URI.makeUnique( respData.media ).toString();
        });
      } else if ( type === "Clyp" ) {
        parsedUri = URI.parse( baseUrl );
        id = parsedUri.directory;

        $.getJSON( clypEndpoint + id, function( respData ) {
          if ( !respData ) {
            return errorCallback( CLYP_EMBED_UNPLAYABLE );
          }
          successCallback({
            source: respData.SecureOggUrl,
            fallback: respData.SecureMp3Url,
            type: type,
            hidden: true,
            title: respData.Title,
            linkback: baseUrl,
            duration: +respData.Duration
          });
        });
      } else if ( type === "null" ) {
        successCallback({
          source: baseUrl,
          type: type,
          title: baseUrl,
          duration: +REGEX_MAP[ "null" ].exec( baseUrl )[ 1 ]
        });
      } else if ( type === "AirMozilla" ) {
        var parsedUri = URI.parse( baseUrl ),
            re = /\/(.+)\//,
            slug = re.exec(parsedUri.directory)[1],
            encodedBaseUrl = encodeURI( baseUrl );

        successOptions = {
          type: type
        };

        xhr.get('https://air.mozilla.org/popcorn/meta/?slug=' + slug,
        function ( resp ) {
          var mediaElem = document.createElement( "video" );
          successOptions.title = resp.title;
          successOptions.source = resp.video_url;
          successOptions.thumbnail = 'https:' + resp.preview_img;
          mediaElem.src = resp.video_url;

          mediaElem.addEventListener( "loadedmetadata", function() {
            successOptions.duration = mediaElem.duration;
            successCallback( successOptions );
          } );

        });

      } else if ( type === "Wikimedia" ) {
        var parsedUri = URI.parse( baseUrl ),
            filename = parsedUri.file.replace( /_/g, ' ' ),
            commonsApi = 'https://commons.wikimedia.org/w/api.php',
            xhrUrl = commonsApi +
                     '?action=query' +
                     '&format=json' +
                     '&formatversion=2' +
                     '&prop=videoinfo' +
                     '&viprop=size|canonicaltitle|url|derivatives|commonmetadata|extmetadata' +
                     '&viurlwidth=640' +
                     '&titles=' + encodeURIComponent( filename ) +
                     '&callback=?'
                     ;

        Popcorn.getJSONP( xhrUrl, function( respData ) {

          if ( respData.query && respData.query.pages && respData.query.pages.length &&
               respData.query.pages[0].videoinfo && respData.query.pages[0].videoinfo.length &&
               respData.query.pages[0].videoinfo[0].duration ) {

            var page = respData.query.pages[0],
                videoinfo = page.videoinfo[0],
                extmetadata = videoinfo.extmetadata;

            successOptions = {
              type: type,
              title: page.title,
              source: videoinfo.url, // @fixme use an appropriate derivative maybe?
              thumbnail: videoinfo.thumburl,
              duration: videoinfo.duration,
              linkback: videoinfo.descriptionurl
            };

            // https://www.mediawiki.org/wiki/Extension:CommonsMetadata#Returned_data
            if ( extmetadata && extmetadata.Artist ) {
                successOptions.author = extmetadata.Artist.value;
            }
            if ( extmetadata && extmetadata.ImageDescription ) {
                // Description may be long, but is localizable which is better
                // than filenames that may be a bunch of random numbers and letters
                // or in a foreign language or otherwise illegible.
                successOptions.title = extmetadata.ImageDescription.value;
            }
            // @fixme add license / attribution information

            successCallback( successOptions );
          } else {
            errorCallback( WIKIMEDIA_EMBED_UNPLAYABLE );
          }
        });

      } else {
        var title = baseUrl.substring( baseUrl.lastIndexOf( "/" ) + 1 ),
            mediaElem,
            errorOptions,
            successOptions,
            encodedBaseUrl = encodeURI( baseUrl );

        errorOptions = {
          source: encodedBaseUrl,
          type: type,
          title: title
        };

        successOptions = {
          source: encodedBaseUrl,
          type: type,
          title: title,
          thumbnail: URI.makeUnique( encodedBaseUrl ).toString()
        };

        Popcorn.getJSONP( nodeHubbleEndpoint + "/mime/" + baseUrl, function( resp ) {
          var contentType = resp.contentType;

          if ( resp.error || !contentType ) {
            return errorCallback( EMBED_UNPLAYABLE );
          }
          successOptions.contentType = errorOptions.contentType = contentType;

          if ( contentType.indexOf( "video" ) === 0 || contentType.indexOf( "application/octet-stream" ) === 0 ) {
            mediaElem = document.createElement( "video" );
          } else if ( contentType.indexOf( "audio" ) === 0 || contentType.indexOf( "application/ogg" ) === 0 ) {
            mediaElem = document.createElement( "audio" );
            successOptions.hidden = errorOptions.hidden = true;
          } else if ( contentType.indexOf( "image" ) === 0 ) {
            successCallback({
              source: encodedBaseUrl,
              type: "image",
              thumbnail: encodedBaseUrl,
              title: encodedBaseUrl,
              contentType: contentType,
              duration: 5
            });
            return;
          }

          if ( mediaElem ) {
            mediaElem.addEventListener( "loadedmetadata", function() {
              successOptions.duration = mediaElem.duration;
              successCallback( successOptions );
            } );
            mediaElem.addEventListener( "error", function() {
              jwPlayerFallback( errorOptions, successCallback, errorCallback );
            } );
            mediaElem.src = URI.makeUnique( encodedBaseUrl ).toString();
          } else {
            errorCallback( EMBED_UNPLAYABLE );
          }
        });
      }
    }
  };
});
