#!/usr/bin/env python3
"""
Yarr Article Viewer - Simple Python Helper with Cinnamon Styling
Clean implementation with proper Cinnamon desktop integration
"""

import tkinter as tk
from tkinter import scrolledtext
import json
import os
import sys
import subprocess
import html
import re
from datetime import datetime
from pathlib import Path
import tempfile
import time

# No GTK imports needed - using desklet settings for colors

class ArticleViewer:
    def __init__(self):
        # Create main window
        self.root = tk.Tk()
        self.root.title("Yarr - Loading Article...")
        self.root.geometry("800x600")
        self.root.minsize(600, 400)
        
        # Apply Cinnamon styling
        self._apply_cinnamon_styling()
        
        # Configure root
        self.root.configure(bg=self.bg_color)
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
        
        # Simple key bindings
        self.root.bind('<Escape>', lambda e: self.on_closing())
        
        # Article data
        self.current_article = None
        self.temp_file_path = None
        
        # Setup UI
        self._setup_ui()
        
        # Try to load article
        self.root.after(500, self._try_load_article)
        
        # Start AI monitoring for background processing
        self._start_ai_monitoring()
        
    def _apply_cinnamon_styling(self):
        """Load desklet colors and apply proper styling from environment variables"""
        try:
            # Load desklet settings from environment variables passed by the desklet
            desklet_settings = self._load_desklet_settings_from_env()
            
            # If no settings from environment, try to load from desklet directory as fallback
            if not desklet_settings:
                print("No environment settings found, trying fallback...")
                desklet_settings = self._load_desklet_settings_fallback()
                if desklet_settings:
                    print(f"Fallback loaded {len(desklet_settings)} settings")
                else:
                    print("No fallback settings available, using hardcoded defaults")
            else:
                print(f"Using {len(desklet_settings)} settings from environment")
            
            # Parse background color (handle both rgb() and hex formats)
            bg_color_raw = desklet_settings.get('backgroundColor', 'rgb(2,22,25)')
            self.bg_color = self._parse_color(bg_color_raw)
            print(f"Parsed background color: {bg_color_raw} -> {self.bg_color}")
            
            # Parse text color
            text_color_raw = desklet_settings.get('text-color', 'rgb(46,194,126)')
            self.fg_color = self._parse_color(text_color_raw)
            print(f"Parsed text color: {text_color_raw} -> {self.fg_color}")
            
            # Parse AI text color
            ai_color_raw = desklet_settings.get('ai_text-color', 'rgb(255,163,72)')
            self.ai_color = self._parse_color(ai_color_raw)
            print(f"Parsed AI color: {ai_color_raw} -> {self.ai_color}")
            
            # Parse read title color if available
            read_color_raw = desklet_settings.get('readTitleColor', 'rgb(38,162,105)')
            self.read_color = self._parse_color(read_color_raw)
            print(f"Parsed read color: {read_color_raw} -> {self.read_color}")
            
            # Parse fonts
            self.main_font = desklet_settings.get('font', 'Liberation Mono 12')
            self.ai_font = desklet_settings.get('ai_font', 'Ubuntu 12')
            print(f"Using fonts: main='{self.main_font}', ai='{self.ai_font}'")
                
            # Set button color to match theme
            if self._is_dark_theme(self.bg_color):
                self.button_bg = '#4a4a4a'  # Dark gray for dark themes
            else:
                self.button_bg = '#e0e0e0'  # Light gray for light themes
                
            print(f"Applied desklet styling: bg={self.bg_color}, fg={self.fg_color}, ai={self.ai_color}")
            print(f"Fonts: main={self.main_font}, ai={self.ai_font}")
                
        except Exception as e:
            print(f"Error applying desklet styling: {e}")
            # Fallback to dark theme colors that match the screenshot
            self.bg_color = '#2d2d2d'
            self.fg_color = '#ffffff'
            self.ai_color = '#ffa448'
            self.read_color = '#26a269'
            self.button_bg = '#4a4a4a'
            self.main_font = 'Liberation Mono 12'
            self.ai_font = 'Ubuntu 12'
            
    def _parse_color(self, color_value):
        """Parse color value from desklet settings (rgb() or hex)"""
        try:
            print(f"Parsing color: '{color_value}'")
            
            if color_value.startswith('rgb('):
                # Parse rgb(r,g,b) format
                rgb_str = color_value.replace('rgb(', '').replace(')', '')
                r, g, b = map(int, rgb_str.split(','))
                result = f'#{r:02x}{g:02x}{b:02x}'
                print(f"RGB parsed: ({r},{g},{b}) -> {result}")
                return result
            elif color_value.startswith('#'):
                # Already hex format
                print(f"Already hex format: {color_value}")
                return color_value
            else:
                # Try to parse as hex without #
                if len(color_value) == 6 and all(c in '0123456789abcdefABCDEF' for c in color_value):
                    result = f'#{color_value}'
                    print(f"Hex without # parsed: {color_value} -> {result}")
                    return result
                else:
                    # Default fallback
                    print(f"Invalid color format, using fallback: {color_value} -> #ffffff")
                    return '#ffffff'
        except Exception as e:
            print(f"Error parsing color '{color_value}': {e}")
            return '#ffffff'
            
    def _parse_font(self, font_spec, size=None, weight=None):
        """Parse font specification from desklet settings"""
        try:
            if not font_spec:
                print(f"Font spec is empty, using defaults: size={size or 10}, weight={weight or 'normal'}")
                return ('Ubuntu', size or 10, weight or 'normal')
                
            print(f"Parsing font: '{font_spec}' with size={size}, weight={weight}")
            
            # Parse font specification (e.g., "Liberation Mono 12" or "Ubuntu 12")
            font_parts = font_spec.split()
            print(f"Font parts: {font_parts}")
            
            # Extract size if not provided
            if size is None:
                # Look for numeric part at the end
                for i, part in enumerate(font_parts):
                    if part.isdigit():
                        size = int(part)
                        font_parts = font_parts[:i] + font_parts[i+1:]
                        print(f"Extracted size: {size}, remaining parts: {font_parts}")
                        break
                if size is None:
                    size = 10  # Default size
                    print(f"No size found, using default: {size}")
            
            # Extract weight if not provided
            if weight is None:
                weight_parts = ['Bold', 'Light', 'Medium', 'Heavy', 'Regular']
                for part in font_parts:
                    if part in weight_parts:
                        weight = part.lower()
                        font_parts.remove(part)
                        print(f"Extracted weight: {weight}, remaining parts: {font_parts}")
                        break
                if weight is None:
                    weight = 'normal'
                    print(f"No weight found, using default: {weight}")
            
            # Join remaining parts as font family
            font_family = ' '.join(font_parts)
            if not font_family:
                font_family = 'Ubuntu'
                print(f"No font family found, using default: {font_family}")
            
            result = (font_family, size, weight)
            print(f"Final parsed font: {result}")
            return result
            
        except Exception as e:
            print(f"Error parsing font '{font_spec}': {e}")
            return ('Ubuntu', size or 10, weight or 'normal')
        
    def _load_desklet_settings_from_env(self):
        """Load desklet settings from environment variables passed by the desklet"""
        try:
            import os
            
            settings = {}
            
            # Load colors from environment variables
            if os.environ.get('YARR_BG_COLOR'):
                settings['backgroundColor'] = os.environ['YARR_BG_COLOR']
                print(f"Loaded background color from env: {os.environ['YARR_BG_COLOR']}")
            if os.environ.get('YARR_TEXT_COLOR'):
                settings['text-color'] = os.environ['YARR_TEXT_COLOR']
                print(f"Loaded text color from env: {os.environ['YARR_TEXT_COLOR']}")
            if os.environ.get('YARR_AI_COLOR'):
                settings['ai_text-color'] = os.environ['YARR_AI_COLOR']
                print(f"Loaded AI color from env: {os.environ['YARR_AI_COLOR']}")
            if os.environ.get('YARR_READ_COLOR'):
                settings['readTitleColor'] = os.environ['YARR_READ_COLOR']
                print(f"Loaded read color from env: {os.environ['YARR_READ_COLOR']}")
                
            # Load fonts from environment variables
            if os.environ.get('YARR_FONT'):
                settings['font'] = os.environ['YARR_FONT']
                print(f"Loaded main font from env: {os.environ['YARR_FONT']}")
            if os.environ.get('YARR_AI_FONT'):
                settings['ai_font'] = os.environ['YARR_AI_FONT']
                print(f"Loaded AI font from env: {os.environ['YARR_AI_FONT']}")
                
            # Load transparency if available
            if os.environ.get('YARR_TRANSPARENCY'):
                try:
                    transparency = float(os.environ['YARR_TRANSPARENCY'])
                    settings['transparency'] = transparency
                    print(f"Loaded transparency from env: {transparency}")
                except ValueError:
                    print(f"Invalid transparency value: {os.environ['YARR_TRANSPARENCY']}")
                    
            print(f"Loaded {len(settings)} settings from environment: {list(settings.keys())}")
            return settings
            
        except Exception as e:
            print(f"Error loading settings from environment: {e}")
            return {}
        
    def _load_desklet_settings_fallback(self):
        """Fallback method to load settings from desklet directory"""
        try:
            desklet_path = os.path.dirname(os.path.abspath(__file__))
            
            # Try to find settings file in desklet directory
            possible_files = [
                'settings-schema.json',  # The schema file
                'desklet-settings.json',
                'yarr@jtoberling.json'
            ]
            
            for filename in possible_files:
                settings_file = os.path.join(desklet_path, filename)
                if os.path.exists(settings_file):
                    try:
                        with open(settings_file, 'r') as f:
                            settings_data = json.load(f)
                            print(f"Loaded fallback settings from {filename}")
                            
                            # Extract default values from schema
                            fallback_settings = {}
                            if 'backgroundColor' in settings_data:
                                fallback_settings['backgroundColor'] = settings_data['backgroundColor'].get('default', 'rgb(2,22,25)')
                                print(f"Fallback background color: {fallback_settings['backgroundColor']}")
                            if 'text-color' in settings_data:
                                fallback_settings['text-color'] = settings_data['text-color'].get('default', 'rgb(46,194,126)')
                                print(f"Fallback text color: {fallback_settings['text-color']}")
                            if 'ai_text-color' in settings_data:
                                fallback_settings['ai_text-color'] = settings_data['ai_text-color'].get('default', 'rgb(255,163,72)')
                                print(f"Fallback AI color: {fallback_settings['ai_text-color']}")
                            if 'font' in settings_data:
                                fallback_settings['font'] = settings_data['font'].get('default', 'Liberation Mono 12')
                                print(f"Fallback main font: {fallback_settings['font']}")
                            if 'ai_font' in settings_data:
                                fallback_settings['ai_font'] = settings_data['ai_font'].get('default', 'Ubuntu 12')
                                print(f"Fallback AI font: {fallback_settings['ai_font']}")
                                
                            print(f"Loaded {len(fallback_settings)} fallback settings")
                            return fallback_settings
                    except Exception as e:
                        print(f"Error reading fallback settings file {filename}: {e}")
                        continue
                        
            print("No fallback settings files found")
            return {}
            
        except Exception as e:
            print(f"Error loading fallback settings: {e}")
            return {}
        
    def _is_dark_theme(self, bg_color):
        """Check if background color indicates dark theme"""
        try:
            # Remove # and convert to RGB
            hex_color = bg_color.lstrip('#')
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16) 
            b = int(hex_color[4:6], 16)
            
            # Calculate luminance
            luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            return luminance < 0.5
            
        except:
            return True  # Default to dark theme
        
    def _setup_ui(self):
        """Setup UI with proper Cinnamon styling"""
        # Main container
        main_frame = tk.Frame(self.root, bg=self.bg_color)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)
        
        # Header
        header_frame = tk.Frame(main_frame, bg=self.bg_color)
        header_frame.pack(fill=tk.X, pady=(0, 15))
        
        # Title and date (left side) - ensure it takes available space
        left_frame = tk.Frame(header_frame, bg=self.bg_color)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        self.title_label = tk.Label(
            left_frame, 
            text="Article Title", 
            bg=self.bg_color,
            fg=self.fg_color,
            font=self._parse_font(self.main_font, weight='bold'),
            anchor='w'
        )
        self.title_label.pack(anchor='w')
        
        # Date and buttons in the same row
        date_button_frame = tk.Frame(left_frame, bg=self.bg_color)
        date_button_frame.pack(anchor='w', pady=(5, 0), fill=tk.X)
        
        self.date_label = tk.Label(
            date_button_frame, 
            text="Publication Date", 
            bg=self.bg_color,
            fg='#666666',
            font=self._parse_font(self.main_font),
            anchor='w'
        )
        self.date_label.pack(side=tk.LEFT)
        
        # Browser button in same row as date
        self.browser_btn = tk.Button(
            date_button_frame, 
            text="🌐 Open in Browser", 
            bg=self.button_bg,
            fg=self.fg_color,
            font=self._parse_font(self.main_font, weight='bold'),
            relief='raised',
            borderwidth=2,
            command=self.open_in_browser,
            width=16,
            height=1
        )
        self.browser_btn.pack(side=tk.LEFT, padx=(20, 0))
        
        # Close button in same row as date
        self.close_btn = tk.Button(
            date_button_frame, 
            text="❌ Close", 
            bg='#dc3545',
            fg='white',
            font=self._parse_font(self.main_font, weight='bold'),
            relief='raised',
            borderwidth=2,
            command=self.on_closing,
            width=16,
            height=1
        )
        self.close_btn.pack(side=tk.LEFT, padx=(10, 0))
        
        print(f"Buttons created in same row as timestamp")
        print(f"Browser button: {self.browser_btn}")
        print(f"Close button: {self.close_btn}")
        
        # Single content section
        content_frame = tk.Frame(main_frame, bg=self.bg_color)
        content_frame.pack(fill=tk.BOTH, expand=True, pady=(15, 0))
        
        # Content label (will show "Description" or "AI Summary")
        self.content_label = tk.Label(
            content_frame, 
            text="Description:", 
            bg=self.bg_color,
            fg=self.fg_color,
            font=self._parse_font(self.main_font, weight='bold'),
            anchor='w'
        )
        self.content_label.pack(anchor='w', pady=(0, 5))
        
        # Single content text area
        self.content_text = scrolledtext.ScrolledText(
            content_frame,
            wrap=tk.WORD,
            font=self._parse_font(self.main_font),
            bg=self.bg_color,
            fg=self.fg_color,
            relief='solid',
            borderwidth=1
        )
        self.content_text.pack(fill=tk.BOTH, expand=True)
        
        # Apply colors to all widgets
        self._apply_colors_to_widgets()
        
    def _apply_colors_to_widgets(self):
        """Apply colors to all widgets recursively"""
        try:
            self._apply_colors_recursive(self.root, self.bg_color, self.fg_color)
        except Exception as e:
            print(f"Error applying colors: {e}")
            
    def _apply_colors_recursive(self, widget, bg_color, fg_color):
        """Recursively apply colors to all widgets"""
        try:
            # Apply background color to frames and labels
            if isinstance(widget, (tk.Frame, tk.Label)):
                widget.configure(bg=bg_color)
                if isinstance(widget, tk.Label):
                    # Check if this is a date label (should use muted color)
                    if widget.cget('text') == 'Publication Date':
                        widget.configure(fg='#666666')
                    else:
                        widget.configure(fg=fg_color)
            
            # Apply colors to text widgets
            elif isinstance(widget, (tk.Text, scrolledtext.ScrolledText)):
                widget.configure(bg=bg_color, fg=fg_color)
            
            # Apply colors to buttons
            elif isinstance(widget, tk.Button):
                # Keep button colors as set, but ensure background matches theme
                if widget.cget('text') == '❌ Close':
                    widget.configure(bg='#dc3545', fg='white')  # Keep close button red
                else:
                    widget.configure(bg=self.button_bg, fg=fg_color)
            
            # Recursively apply to all children
            for child in widget.winfo_children():
                self._apply_colors_recursive(child, bg_color, fg_color)
                
        except Exception as e:
            print(f"Error applying colors to widget {widget}: {e}")
            
    def _start_ai_monitoring(self):
        """Start polling for AI results every 5 seconds"""
        try:
            print("Starting AI result polling...")
            # Poll for AI results every 5 seconds
            self.root.after(5000, self._poll_ai_results)
        except Exception as e:
            print(f"Error starting AI monitoring: {e}")
            
    def _poll_ai_results(self):
        """Poll for AI results from desklet - simple polling every 5s"""
        try:
            if not self.current_article:
                # Schedule next poll
                self.root.after(5000, self._poll_ai_results)
                return
                
            # Look for AI result file with our commId
            comm_id = self.current_article.get('commId', '')
            if not comm_id:
                # Schedule next poll
                self.root.after(5000, self._poll_ai_results)
                return
                
            temp_dir = tempfile.gettempdir()
            ai_result_file = os.path.join(temp_dir, f'yarr_ai_{comm_id}.tmp')
            
            if os.path.exists(ai_result_file):
                try:
                    with open(ai_result_file, 'r') as f:
                        ai_data = json.load(f)
                        
                    ai_response = ai_data.get('aiResponse', '')
                    if ai_response:
                        print(f"Found AI result, updating display...")
                        self.update_ai_summary(ai_response)
                        
                        # Delete the AI result file
                        try:
                            os.unlink(ai_result_file)
                            print(f"Cleaned up AI result file")
                        except Exception as e:
                            print(f"Error cleaning up AI result file: {e}")
                        return  # Stop polling once we get the result
                        
                except Exception as e:
                    print(f"Error reading AI result file: {e}")
                    # Remove corrupted file
                    try:
                        os.unlink(ai_result_file)
                    except:
                        pass
                        
        except Exception as e:
            print(f"Error polling for AI results: {e}")
            
        # Schedule next poll
        self.root.after(5000, self._poll_ai_results)
        
    def _try_load_article(self):
        """Try to load article from temp file"""
        try:
            print("Trying to load article...")
            article_data = self._load_article_from_file()
            if article_data:
                print(f"Found article: {article_data.get('title', 'No title')}")
                self.display_article(article_data)
            else:
                print("No article data found - showing empty viewer")
                # Set default window title
                self.root.title("Yarr - No Article")
                # Show the window even without article data
                self.root.deiconify()
                self.root.lift()
                self.root.focus_force()
        except Exception as e:
            print(f"Error loading article: {e}")
            # Show the window even on error
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
            
    def _load_article_from_file(self):
        """Load article from temp file - simple"""
        try:
            temp_dir = tempfile.gettempdir()
            print(f"Looking for article files in: {temp_dir}")
            
            # Look for most recent article file
            article_files = []
            for file_path in Path(temp_dir).glob('yarr_article_*.json'):
                if file_path.exists():
                    stat = file_path.stat()
                    article_files.append((file_path, stat.st_mtime))
                    print(f"Found article file: {file_path.name}")
            
            if not article_files:
                print("No article files found")
                return None
            
            # Get most recent file
            article_files.sort(key=lambda x: x[1], reverse=True)
            file_path = article_files[0][0]
            print(f"Loading file: {file_path.name}")
            
            # Load article data
            with open(file_path, 'r') as f:
                article_data = json.load(f)
            
            print(f"Loaded article: {article_data.get('title', 'No title')}")
            
            # Store file path for cleanup when AI summary is displayed
            self.temp_file_path = file_path
                
            return article_data
            
        except Exception as e:
            print(f"Error loading article file: {e}")
            return None
            
    def display_article(self, article_data):
        """Display article data"""
        try:
            print("Displaying article...")
            self.current_article = article_data
            
            # Update title
            title = article_data.get('title', 'Untitled')
            if len(title) > 100:
                title = title[:97] + '...'
            self.title_label.config(text=title)
            
            # Update window title with article title
            window_title = f"Yarr - {title}"
            if len(window_title) > 80:  # Limit window title length
                window_title = f"Yarr - {title[:77]}..."
            self.root.title(window_title)
            
            print(f"Set title: {title}")
            print(f"Set window title: {window_title}")
            

            
            # Update date
            date_str = self._format_date(article_data)
            self.date_label.config(text=date_str)
            print(f"Set date: {date_str}")
            
            # Check if AI summary is available
            ai_response = article_data.get('aiResponse', '')
            if ai_response and ai_response.strip() and not ai_response.startswith('Error:'):
                # Show AI summary
                self.content_label.config(text="AI Summary:", fg=self.ai_color)
                clean_content = ai_response
                print(f"Showing AI summary (length: {len(ai_response)})")
            else:
                # Show description
                self.content_label.config(text="Description:", fg=self.fg_color)
                desc = article_data.get('description', 'No description available')
                clean_content = self._clean_html(desc)
                print(f"Showing description (length: {len(clean_content)})")
            
            # Update content
            self.content_text.delete(1.0, tk.END)
            self.content_text.insert(1.0, clean_content)
            
            # Desklet automatically starts AI processing if no summary exists
            
            # Show window
            print("Showing window...")
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
            print("Window should now be visible")
            
        except Exception as e:
            print(f"Error displaying article: {e}")
            # Show window even on error
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
            
    def _format_date(self, article_data):
        """Format date simply"""
        try:
            date_str = article_data.get('date', '')
            if not date_str:
                date_str = (article_data.get('pubDate', '') or 
                           article_data.get('timestamp', '') or 
                           article_data.get('published', ''))
            
            if date_str and date_str != 'Unknown date':
                try:
                    if isinstance(date_str, (int, float)):
                        date_obj = datetime.fromtimestamp(date_str)
                    elif 'T' in str(date_str):
                        date_str_clean = str(date_str).replace('Z', '+00:00')
                        date_obj = datetime.fromisoformat(date_str_clean)
                    else:
                        # Try common formats
                        for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d']:
                            try:
                                date_obj = datetime.strptime(str(date_str), fmt)
                                break
                            except ValueError:
                                continue
                        else:
                            date_obj = datetime.now()
                    
                    return date_obj.strftime('%B %d, %Y at %H:%M')
                except:
                    pass
                    
            return 'Date unavailable'
            
        except Exception as e:
            print(f"Error formatting date: {e}")
            return 'Date unavailable'
            
    def _clean_html(self, html_content):
        """Clean HTML content simply"""
        try:
            if not html_content:
                return "No content available"
                
            # Remove HTML tags
            clean_text = re.sub(r'<[^>]+>', '', str(html_content))
            
            # Decode HTML entities
            try:
                clean_text = html.unescape(clean_text)
            except:
                pass
                
            # Clean whitespace
            clean_text = re.sub(r'\s+', ' ', clean_text)
            clean_text = clean_text.strip()
            
            # Limit length
            if len(clean_text) > 2000:
                clean_text = clean_text[:1997] + '...'
                
            return clean_text
            
        except Exception as e:
            print(f"Error cleaning HTML: {e}")
            return "Content unavailable"
            
    def update_ai_summary(self, ai_text):
        """Update AI summary and cleanup temp file when done"""
        try:
            self.content_text.delete(1.0, tk.END)
            
            if ai_text and ai_text.strip():
                if ai_text.startswith('Error:'):
                    self.content_text.insert(1.0, ai_text)
                    self.content_label.config(text="Error:", fg='#dc3545')
                    self._update_window_title_with_status("Error")
                elif ai_text.startswith('AI processing started'):
                    self.content_text.insert(1.0, ai_text + "\n\nPlease wait while AI processes the article...")
                    self.content_label.config(text="Processing...", fg='#f39c12')
                    self._update_window_title_with_status("Processing")
                else:
                    # AI summary is ready - display it and cleanup temp file
                    self.content_text.insert(1.0, ai_text)
                    self.content_label.config(text="AI Summary:", fg=self.ai_color)
                    self._update_window_title_with_status("Ready")
                    self._cleanup_temp_file()
            else:
                self.content_text.insert(1.0, "AI summary not yet available. Processing in background...")
                self.content_label.config(text="Processing...", fg='#f39c12')
                self._update_window_title_with_status("Processing")
                
        except Exception as e:
            print(f"Error updating AI summary: {e}")
            
    def _update_window_title_with_status(self, status):
        """Update window title to include AI status"""
        try:
            if self.current_article and self.current_article.get('title'):
                title = self.current_article.get('title', 'Untitled')
                if len(title) > 60:  # Shorter limit for status
                    title = title[:57] + '...'
                window_title = f"Yarr - {title} [{status}]"
            else:
                window_title = f"Yarr - [{status}]"
                
            self.root.title(window_title)
            print(f"Updated window title: {window_title}")
            
        except Exception as e:
            print(f"Error updating window title: {e}")
            
    def _cleanup_temp_file(self):
        """Clean up temp file when AI summary is displayed"""
        try:
            if hasattr(self, 'temp_file_path') and self.temp_file_path:
                if self.temp_file_path.exists():
                    self.temp_file_path.unlink()
                    print(f"Cleaned up temp file: {self.temp_file_path.name}")
                self.temp_file_path = None
        except Exception as e:
            print(f"Error cleaning up temp file: {e}")
            
    def show_status(self, message):
        """Show status message"""
        try:
            status_label = tk.Label(
                self.root,
                text=message,
                bg='#28a745',
                fg='white',
                font=('Ubuntu', 10, 'bold'),
                relief='raised',
                borderwidth=2
            )
            
            status_label.place(relx=0.5, rely=0.95, anchor='center')
            self.root.after(2000, status_label.destroy)
            
        except Exception as e:
            print(f"Error showing status: {e}")
            
    def open_in_browser(self):
        """Open in browser"""
        try:
            print("Browser button clicked!")
            if self.current_article and self.current_article.get('link'):
                print(f"Opening link: {self.current_article['link']}")
                subprocess.Popen(['xdg-open', self.current_article['link']], 
                               stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL)
            else:
                print("No link available")
        except Exception as e:
            print(f"Error opening browser: {e}")
            self.show_status("Failed to open browser")
            
    def on_closing(self):
        """Handle window closing - simple and direct"""
        try:
            print("Close button clicked!")
            print("Closing article viewer...")
            self.root.destroy()
            sys.exit(0)
        except Exception as e:
            print(f"Error during closing: {e}")
            sys.exit(1)
        
    def show(self):
        """Show window"""
        try:
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
        except Exception as e:
            print(f"Error showing window: {e}")
            
    def hide(self):
        """Hide window"""
        try:
            self.root.withdraw()
        except Exception as e:
            print(f"Error hiding window: {e}")

def main():
    """Main function"""
    try:
        print("Starting Yarr Article Viewer...")
        viewer = ArticleViewer()
        print("Viewer created, starting main loop...")
        viewer.root.mainloop()
        print("Main loop ended")
    except Exception as e:
        print(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()