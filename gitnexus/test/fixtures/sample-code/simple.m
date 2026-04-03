#import <Foundation/Foundation.h>

@interface MyViewController : NSObject
- (void)loadData;
@end

@implementation MyViewController
- (void)loadData {
    NSLog(@"Loading");
}
@end

static void helperFunction(void) {
}
