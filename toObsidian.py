import os
import re
import shutil
import argparse
from urllib.parse import unquote


def process_markdown_files(source_root, target_blog, target_images):
    """
    处理所有Markdown文件，转换内容并复制相关资源
    :param source_root: 源_posts目录路径
    :param target_blog: 目标Blog目录路径
    :param target_images: 目标images目录路径
    """
    # 确保目标目录存在
    os.makedirs(target_blog, exist_ok=True)
    os.makedirs(target_images, exist_ok=True)

    # 计算站点根目录（source_root的父目录）
    site_root = os.path.dirname(source_root)

    # 遍历所有子目录和文件
    for root, dirs, files in os.walk(source_root):
        for file in files:
            if file.endswith(('.md', '.md.bak')):
                source_file = os.path.join(root, file)

                # 获取相对路径和分类目录
                rel_path = os.path.relpath(root, source_root)
                if rel_path == ".":
                    rel_path = ""

                # 处理目标文件路径
                target_dir = os.path.join(target_blog, rel_path)
                os.makedirs(target_dir, exist_ok=True)

                # 新文件名（确保为.md后缀）
                new_filename = file.replace(
                    '.md.bak', '.md').replace('.md', '.md')
                target_file = os.path.join(target_dir, new_filename)

                # 读取并处理文件内容
                with open(source_file, 'r', encoding='utf-8') as f:
                    content = f.read()

                # 移除YAML头部
                content = re.sub(r'^---[\s\S]*?---\n', '', content)

                # 移除<!--more-->标签
                content = content.replace('<!--more-->', '')

                # 转换图片引用
                content, images_to_copy = convert_image_refs(
                    content, site_root, target_images)

                # 写入处理后的内容
                with open(target_file, 'w', encoding='utf-8') as f:
                    f.write(content)

                # 复制图片文件
                for source_img, target_img in images_to_copy:
                    os.makedirs(os.path.dirname(target_img), exist_ok=True)
                    if os.path.exists(source_img):
                        shutil.copy2(source_img, target_img)
                        print(f"Copied image: {source_img} -> {target_img}")
                    else:
                        # 尝试使用URL解码后的路径
                        decoded_source = unquote(source_img)
                        if os.path.exists(decoded_source):
                            shutil.copy2(decoded_source, target_img)
                            print(
                                f"Copied image (decoded): {decoded_source} -> {target_img}")
                        else:
                            # 尝试在assets目录下查找
                            alt_source = os.path.join(site_root, 'assets', unquote(
                                source_img.split('assets/')[-1]))
                            if os.path.exists(alt_source):
                                shutil.copy2(alt_source, target_img)
                                print(
                                    f"Copied image (alt path): {alt_source} -> {target_img}")
                            else:
                                print(
                                    f"Warning: Image not found: {source_img}")
                                # 尝试列出可能的路径
                                print(
                                    f"  Tried paths: {source_img}, {decoded_source}, {alt_source}")


def convert_image_refs(content, site_root, target_images):
    """
    转换图片引用格式并准备复制文件
    :param content: Markdown内容
    :param site_root: 站点根目录
    :param target_images: 目标images目录
    :return: 转换后的内容和需要复制的图片列表
    """
    images_to_copy = []

    # 匹配所有图片引用 - 更灵活的正则表达式
    pattern = r'!\[(.*?)\]\(([^)]+)\)'

    def replace_match(match):
        alt_text = match.group(1)
        img_path = match.group(2)

        # 处理可能的URL编码
        decoded_path = unquote(img_path)

        # 处理可能的查询参数
        clean_path = decoded_path.split('?')[0]

        # 标准化路径
        if clean_path.startswith('/'):
            # 绝对路径（相对于站点根目录）
            img_path = clean_path.lstrip('/')
            source_img = os.path.join(site_root, img_path)
        elif clean_path.startswith('./'):
            # 相对路径
            img_path = clean_path[2:]
            source_img = os.path.join(site_root, img_path)
        else:
            # 其他相对路径
            source_img = os.path.join(
                site_root, 'assets', 'images', clean_path)

        # 创建目标路径
        img_filename = os.path.basename(img_path)
        target_img = os.path.join(target_images, img_filename)

        # 添加待复制列表
        images_to_copy.append((source_img, target_img))

        # 返回Obsidian格式的引用
        return f'![[images/{img_filename}]]'

    # 执行替换
    new_content = re.sub(pattern, replace_match, content)
    return new_content, images_to_copy


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='迁移博客内容到Obsidian')
    parser.add_argument('--source', default=r'D:\Web\Zucker-jex.github.io\_posts',
                        help='源_posts目录路径')
    parser.add_argument('--target-blog', default=r'D:\Users\jexzu\Obsidian\Note\Blog',
                        help='目标Blog目录路径')
    parser.add_argument('--target-images', default=r'D:\Users\jexzu\Obsidian\Note\Blog\images',
                        help='目标images目录路径')

    args = parser.parse_args()

    print("开始迁移博客内容...")
    print(f"源目录: {args.source}")
    print(f"目标博客目录: {args.target_blog}")
    print(f"目标图片目录: {args.target_images}")
    print("-" * 50)

    process_markdown_files(
        source_root=args.source,
        target_blog=args.target_blog,
        target_images=args.target_images
    )

    print("\n迁移完成！")
