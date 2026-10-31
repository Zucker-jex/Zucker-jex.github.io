(function() {
  var SOURCES = window.TEXT_VARIABLES.sources;
  window.Lazyload.js(SOURCES.jquery, function() {
    function toc(options) {
      var $root = this, $window = $(window), $scrollTarget, $scroller,
        $tocUl, $headings, headingItems = [], headingPositions = [],
        activeItem = null,
        selectors = 'h1,h2,h3', container = 'body', scrollTarget = window, scroller = 'html, body',
        disabled = false, scrolling = false, hasRendered = false, hasInit = false,
        isWindowScroller = true, userScrollPause = 0, fontsBound = false, scrollLockTimer = null,
        SPY_OFFSET = 24, SCROLL_MARGIN = 12;

      function setOptions(options) {
        var _options = options || {},
          wasDisabled = disabled;
        _options.selectors && (selectors = _options.selectors);
        _options.container && (container = _options.container);
        _options.scrollTarget && (scrollTarget = _options.scrollTarget);
        _options.scroller && (scroller = _options.scroller);
        _options.disabled !== undefined && (disabled = _options.disabled);
        $headings = $(container).find(selectors).filter('[id]');
        $scrollTarget = $(scrollTarget);
        $scroller = $(scroller);
        isWindowScroller = $scrollTarget[0] === window;

        /* The aside is hidden on narrow screens; build it once it becomes visible. */
        if (wasDisabled && !disabled) {
          init();
        }
      }

      /* Build a heading tree based on the heading levels (h1 > h2 > h3 ...). */
      function buildHeadingTree() {
        var tree = [],
          stack = [{ level: 0, children: tree }];

        $headings.each(function() {
          var $heading = $(this),
            level = parseInt($heading.prop('tagName').toLowerCase().charAt(1), 10),
            node = {
              level: level,
              id: $heading.prop('id'),
              text: $.trim($heading.text()),
              children: []
            };

          while (stack.length > 1 && stack[stack.length - 1].level >= level) {
            stack.pop();
          }

          stack[stack.length - 1].children.push(node);
          stack.push({ level: level, children: node.children });
        });

        return tree;
      }

      function renderTree(nodes, $parentUl) {
        $.each(nodes, function(_, node) {
          var $li = $('<li></li>').addClass('toc-h' + node.level),
            $row = $('<div class="toc-row"></div>'),
            $link = $('<a class="toc-link"></a>').attr('href', '#' + node.id);

          $link.append($('<span class="toc-label"></span>').text(node.text));

          if (node.children.length > 0) {
            var $toggle = $('<button type="button" class="toc-toggle"></button>')
              .attr('aria-expanded', 'true')
              .attr('aria-label', '折叠或展开子目录');

            $li.addClass('toc-has-children');
            $row.append($toggle);
            $toggle.on('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              setCollapsed($li, !$li.hasClass('is-collapsed'), true);
            });
          } else {
            $row.addClass('toc-row--leaf');
          }

          $row.append($link);
          $li.append($row);
          $parentUl.append($li);

          /* Pre-order traversal keeps this list in the same order as the headings. */
          headingItems.push($li);

          if (node.children.length > 0) {
            var $childUl = $('<ul class="toc-children"></ul>');
            renderTree(node.children, $childUl);
            $li.append($childUl);
          }
        });
      }

      function setCollapsed($li, collapsed, byUser) {
        if (!$li.hasClass('toc-has-children')) { return; }

        $li.toggleClass('is-collapsed', collapsed)
          .children('.toc-row')
          .find('.toc-toggle')
          .attr('aria-expanded', collapsed ? 'false' : 'true');

        $li.children('.toc-children').attr('aria-hidden', collapsed ? 'true' : 'false');

        if (byUser) {
          $li.data('tocUserCollapsed', collapsed);
        }

        if (!collapsed) {
          window.setTimeout(checkTruncation, 0);
        }
      }

      function expandAncestors($li) {
        $li.parents('li.toc-has-children').each(function() {
          var $parent = $(this);
          if (!$parent.data('tocUserCollapsed')) {
            setCollapsed($parent, false, false);
          }
        });

        if (!$li.data('tocUserCollapsed')) {
          setCollapsed($li, false, false);
        }
      }

      function collapseAll() {
        $tocUl.find('li.toc-has-children').each(function() {
          setCollapsed($(this), true, false);
        });
      }

      function getScrollTop() {
        return isWindowScroller ? ($window.scrollTop() || window.pageYOffset || 0) : $scrollTarget.scrollTop();
      }

      function getViewportHeight() {
        return isWindowScroller ? $window.height() : $scrollTarget.innerHeight();
      }

      function getScrollHeight() {
        return isWindowScroller ? $(document).height() : $scrollTarget[0].scrollHeight;
      }

      /* Cache heading positions relative to the actual scroll container. */
      function calc() {
        headingPositions = [];
        var scrollTop = getScrollTop(),
          rootTop = 0;

        if (!isWindowScroller && $scrollTarget.length) {
          rootTop = $scrollTarget[0].getBoundingClientRect().top;
        }

        $headings.each(function() {
          var rect = this.getBoundingClientRect(),
            top = isWindowScroller
              ? rect.top + (window.pageYOffset || document.documentElement.scrollTop || 0)
              : rect.top - rootTop + scrollTop;

          headingPositions.push(Math.floor(top));
        });
      }

      function findActiveIndex() {
        var scrollTop = getScrollTop(),
          position = scrollTop + SPY_OFFSET,
          index = headingPositions.length > 0 ? 0 : -1,
          i;

        for (i = 0; i < headingPositions.length; i++) {
          if (position >= headingPositions[i]) {
            index = i;
          } else {
            break;
          }
        }

        /* At the very bottom the last heading is usually too short to reach the spy line. */
        if (index > -1 && scrollTop + getViewportHeight() >= getScrollHeight() - 2) {
          index = headingPositions.length - 1;
        }

        return index;
      }

      function scrollTocToItem($li, force) {
        if (!$root.length || !$li.length || $li[0].offsetParent === null) { return; }
        if (!force && Date.now() < userScrollPause) { return; }

        var root = $root[0],
          rootRect = root.getBoundingClientRect(),
          itemRect = $li[0].getBoundingClientRect(),
          itemTop = itemRect.top - rootRect.top + root.scrollTop,
          itemBottom = itemTop + itemRect.height,
          viewTop = root.scrollTop,
          viewBottom = viewTop + root.clientHeight;

        if (itemTop < viewTop + SCROLL_MARGIN) {
          root.scrollTop = Math.max(0, itemTop - SCROLL_MARGIN);
        } else if (itemBottom > viewBottom - SCROLL_MARGIN) {
          root.scrollTop = itemBottom - root.clientHeight + SCROLL_MARGIN;
        }
      }

      function setState(element, disabledFlag, force) {
        if (disabledFlag || !headingItems.length) { return; }

        var index = -1,
          $current;

        if (element) {
          index = $.inArray(element[0], headingItems);
        } else {
          index = findActiveIndex();
        }

        if (index < 0 || index >= headingItems.length) { return; }

        $current = $(headingItems[index]);

        var changed = !activeItem || activeItem[0] !== $current[0];

        if (changed) {
          activeItem && activeItem.removeClass('active').removeAttr('aria-current');
          activeItem = $current;
          activeItem.addClass('active').attr('aria-current', 'location');
          expandAncestors(activeItem);
        }

        if (changed || force) {
          scrollTocToItem(activeItem, force);
        }
      }

      /* Only long labels get the marquee class, so short labels never move. */
      function checkTruncation() {
        $tocUl.find('.toc-link').each(function() {
          var link = this,
            label = link.querySelector('.toc-label');

          if (!label || !link.clientWidth) { return; }

          var available = link.clientWidth,
            needed = label.scrollWidth,
            truncated = needed > available + 1;

          $(link).toggleClass('is-truncated', truncated);

          if (truncated) {
            var distance = needed - available,
              duration = Math.max(5, Math.min(20, 4 + distance / 25));

            link.style.setProperty('--toc-marquee-distance', distance + 'px');
            link.style.setProperty('--toc-marquee-duration', duration.toFixed(1) + 's');
            link.setAttribute('title', label.textContent);
          } else {
            link.style.removeProperty('--toc-marquee-distance');
            link.style.removeProperty('--toc-marquee-duration');
            link.removeAttribute('title');
          }
        });
      }

      function render() {
        if (!hasRendered) {
          var tree = buildHeadingTree();

          $tocUl = $('<ul class="toc toc--ellipsis"></ul>');
          $root.append($tocUl);

          headingItems = [];
          renderTree(tree, $tocUl);
          collapseAll();

          $tocUl.on('click', '.toc-link', function(e) {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }

            e.preventDefault();

            var $link = $(this),
              $li = $link.closest('li');

            /* A parent title toggles its branch; a leaf keeps the branch open. */
            if ($li.hasClass('toc-has-children')) {
              setCollapsed($li, !$li.hasClass('is-collapsed'), true);
            }

            /* Navigating to a collapsed branch should reveal its ancestors. */
            expandAncestors($li);
            scrolling = true;
            setState($li, false, true);

            window.clearTimeout(scrollLockTimer);
            scrollLockTimer = window.setTimeout(function() {
              /* Safety net in case the scroll animation is interrupted. */
              scrolling = false;
              if (!disabled) { setState(null, false); }
            }, 700);

            $scroller.scrollToAnchor($link.attr('href'), 400, function() {
              window.clearTimeout(scrollLockTimer);
              scrolling = false;
              if (!disabled) { setState(null, false); }
            });
          });

          $root.on('wheel touchstart', function() {
            /* Do not fight the user while they are browsing the TOC itself. */
            userScrollPause = Date.now() + 1500;
          });

          hasRendered = true;
        }

        checkTruncation();
      }

      function init() {
        var interval, timeout;

        if (disabled) { return; }

        if (!hasInit) {
          render();

          interval = window.setInterval(calc, 200);
          timeout = window.setTimeout(function() {
            window.clearInterval(interval);
          }, 45000);

          window.pageLoad.then(function() {
            window.setTimeout(function() {
              if (!disabled) {
                calc();
                setState(null, scrolling);
                checkTruncation();
              }
            }, 300);

            window.setTimeout(function() {
              window.clearInterval(interval);
              window.clearTimeout(timeout);
            }, 3000);
          });

          if (!fontsBound && document.fonts && document.fonts.ready) {
            fontsBound = true;
            document.fonts.ready.then(function() {
              window.setTimeout(function() {
                if (!disabled) {
                  calc();
                  checkTruncation();
                }
              }, 50);
            });
          }

          $scrollTarget.on('scroll', function() {
            disabled || setState(null, scrolling);
          });

          $window.on('resize', window.throttle(function() {
            if (!disabled) {
              calc();
              setState(null, scrolling);
              checkTruncation();
            }
          }, 100));

          hasInit = true;
        }

        calc();
        setState(null, scrolling);
        checkTruncation();
      }

      setOptions(options);
      if (!disabled) {
        init();
      }
      $window.on('resize', window.throttle(function() {
        init();
      }, 200));
      return {
        setOptions: setOptions
      };
    }
    $.fn.toc = toc;
  });
})();
